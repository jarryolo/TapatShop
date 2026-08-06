import type { Prisma } from "@tapatshop/db";

import { db } from "@/lib/db";
import { type Cents, memberUnitPrice } from "@/lib/utils/money";

import { liveWhere } from "./content.service";
import { idFilter, searchProductIds } from "./search.service";

/**
 * How many search hits can be combined with filters.
 *
 * Search resolves to a list of ids that then feed an `IN (...)`. Unbounded, a one-letter
 * query would put the whole catalog in one clause, so it is capped well above any page size.
 */
const SEARCH_ID_CEILING = 500;

/**
 * The public catalog: what a shopper sees. Read-only.
 *
 * Every query here runs on a page a customer waits for, so the shape matters more than in
 * the admin. The rule throughout: a fixed number of queries per page, never one per row.
 */

export type SortOption = "newest" | "price_asc" | "price_desc" | "popular";

export interface CatalogQuery {
  categorySlug?: string;
  q?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  sort?: SortOption;
  page?: number;
  limit?: number;
}

export interface CatalogCard {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  /** Lowest active variant price. What a "from ₱x" label shows. */
  priceCents: Cents;
  /** Highest compare-at among active variants, or null when nothing is discounted. */
  compareAtPriceCents: Cents | null;
  memberPriceCents: Cents | null;
  stockQty: number;
  lowStockThreshold: number;
  variantCount: number;
}

export interface CatalogPage {
  data: CatalogCard[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  /** Set when a search term was corrected, so the page can say what it actually searched for. */
  correctedTo?: string;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

/**
 * Only active products with an active variant are ever visible.
 *
 * Draft and archived products must not leak into any public listing, so this predicate is
 * built in one place rather than repeated at each call site where one could be forgotten.
 */
function publicWhere(query: CatalogQuery): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {
    status: "active",
    variants: { some: { isActive: true } },
  };

  if (query.categorySlug) {
    where.category = { slug: query.categorySlug, isActive: true };
  }

  const priceFilter: Prisma.IntFilter = {};
  if (typeof query.minPriceCents === "number") priceFilter.gte = query.minPriceCents;
  if (typeof query.maxPriceCents === "number") priceFilter.lte = query.maxPriceCents;

  const variantConditions: Prisma.ProductVariantWhereInput = { isActive: true };
  if (Object.keys(priceFilter).length > 0) variantConditions.priceCents = priceFilter;
  if (query.inStockOnly) variantConditions.stockQty = { gt: 0 };

  if (Object.keys(variantConditions).length > 1) {
    where.variants = { some: variantConditions };
  }

  return where;
}

/** The select used for every card, so listings cannot drift apart from each other. */
const cardSelect = {
  id: true,
  name: true,
  slug: true,
  brand: true,
  category: { select: { name: true } },
  images: { select: { url: true, alt: true }, orderBy: { sortOrder: "asc" }, take: 1 },
  variants: {
    where: { isActive: true },
    select: {
      priceCents: true,
      compareAtPriceCents: true,
      stockQty: true,
      lowStockThreshold: true,
    },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

function toCard(product: CardRow, memberDiscountPercent: number): CatalogCard {
  const prices = product.variants.map((v) => v.priceCents);
  const priceCents = prices.length > 0 ? Math.min(...prices) : 0;

  // Compare-at is shown against the cheapest variant, and only when it is a real saving.
  const cheapest = product.variants.find((v) => v.priceCents === priceCents);
  const compareAt = cheapest?.compareAtPriceCents ?? null;

  const image = product.images[0];

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    categoryName: product.category?.name ?? null,
    imageUrl: image?.url ?? null,
    imageAlt: image?.alt ?? null,
    priceCents,
    compareAtPriceCents: compareAt && compareAt > priceCents ? compareAt : null,
    memberPriceCents:
      memberDiscountPercent > 0 ? memberUnitPrice(priceCents, memberDiscountPercent) : null,
    stockQty: product.variants.reduce((sum, v) => sum + v.stockQty, 0),
    lowStockThreshold: Math.max(...product.variants.map((v) => v.lowStockThreshold), 0),
    variantCount: product.variants.length,
  };
}

/**
 * The member discount, from settings. Zero disables member pricing entirely — docs/01.
 *
 * Read once per request and threaded through, rather than looked up per card.
 */
export async function memberDiscountPercent(): Promise<number> {
  const setting = await db.setting.findUnique({ where: { key: "member_discount_percent" } });
  const value = setting?.value;
  return typeof value === "number" && value > 0 && value <= 100 ? value : 0;
}

/**
 * A page of products.
 *
 * Query count is fixed: one count, one findMany, and for the popular sort two more. Prisma
 * resolves the `images` and `variants` includes with one extra query each for the whole
 * page, not one per product — which is the N+1 this page would otherwise have.
 */
export async function listCatalog(query: CatalogQuery, memberPercent = 0): Promise<CatalogPage> {
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const page = Math.max(1, query.page ?? 1);
  const where = publicWhere(query);

  /**
   * A search term resolves to a set of ids first, then the normal filters apply on top.
   *
   * Search ranking and filtering are separate concerns: the FULLTEXT index decides what
   * matches, and the category, price and stock filters narrow it. Trying to express both in
   * one Prisma `where` would mean giving up relevance ordering.
   */
  let correctedTo: string | undefined;
  if (query.q && query.q.trim().length > 0) {
    const outcome = await searchProductIds(query.q, SEARCH_ID_CEILING);
    correctedTo = outcome.correctedTo;
    Object.assign(where, idFilter(outcome.productIds));

    if (outcome.productIds.length === 0) {
      return { data: [], meta: { page: 1, limit, total: 0, totalPages: 1 } };
    }
  }

  // Price and popularity both rank on something Prisma cannot express as an orderBy over a
  // relation aggregate, so they take the ranked path below.
  if (query.sort === "popular" || query.sort === "price_asc" || query.sort === "price_desc") {
    const ranked = await listRanked(where, query.sort, page, limit, memberPercent);
    return { ...ranked, correctedTo };
  }

  const orderBy = sortToOrderBy(query.sort);

  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      select: cardSelect,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: rows.map((row) => toCard(row, memberPercent)),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    correctedTo,
  };
}

/** Sorts Prisma can express directly. Ties break on id so page 2 never repeats page 1. */
function sortToOrderBy(sort: SortOption | undefined): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "newest":
    default:
      return [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }];
  }
}

/**
 * Sorts that rank on an aggregate of a product's variants.
 *
 * Prisma has no orderBy for "the minimum priceCents across this product's variants", and
 * ordering by `variants._count` instead would sort by how many options a product has — which
 * looks plausible and is completely wrong. So the ranking is computed explicitly.
 *
 * Four queries, none of them per-row: matching ids, the aggregate, the page's products, and
 * for popularity the variant-to-product map. It ranks in memory, which holds to a few
 * thousand matching products — the same ceiling docs/03 gives FULLTEXT before recommending a
 * read-side index. Past that, this is the query to push into the database.
 */
async function listRanked(
  where: Prisma.ProductWhereInput,
  sort: "popular" | "price_asc" | "price_desc",
  page: number,
  limit: number,
  memberPercent: number
): Promise<CatalogPage> {
  const matching = await db.product.findMany({ where, select: { id: true } });
  const ids = matching.map((p) => p.id);

  if (ids.length === 0) {
    return { data: [], meta: { page: 1, limit, total: 0, totalPages: 1 } };
  }

  const score = new Map<string, number>();

  if (sort === "popular") {
    const [sales, owners] = await Promise.all([
      db.orderItem.groupBy({
        by: ["variantId"],
        where: { variant: { productId: { in: ids } }, order: { paymentStatus: "paid" } },
        _sum: { quantity: true },
      }),
      db.productVariant.findMany({
        where: { productId: { in: ids } },
        select: { id: true, productId: true },
      }),
    ]);

    const ownerOf = new Map(owners.map((v) => [v.id, v.productId]));
    for (const row of sales) {
      if (!row.variantId) continue;
      const productId = ownerOf.get(row.variantId);
      if (!productId) continue;
      score.set(productId, (score.get(productId) ?? 0) + (row._sum.quantity ?? 0));
    }
  } else {
    // The cheapest active variant — the same number the card shows as "from".
    const grouped = await db.productVariant.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, isActive: true },
      _min: { priceCents: true },
    });
    for (const row of grouped) {
      score.set(row.productId, row._min.priceCents ?? 0);
    }
  }

  const descending = sort === "popular" || sort === "price_desc";
  const ranked = [...ids].sort((a, b) => {
    const left = score.get(a) ?? 0;
    const right = score.get(b) ?? 0;
    const delta = descending ? right - left : left - right;
    return delta !== 0 ? delta : a.localeCompare(b);
  });

  const total = ranked.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const clamped = Math.min(page, totalPages);
  const pageIds = ranked.slice((clamped - 1) * limit, clamped * limit);

  const rows = await db.product.findMany({ where: { id: { in: pageIds } }, select: cardSelect });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    // findMany returns its own order, so the ranking is reapplied here.
    data: pageIds
      .map((id) => byId.get(id))
      .filter((row): row is CardRow => Boolean(row))
      .map((row) => toCard(row, memberPercent)),
    meta: { page: clamped, limit, total, totalPages },
  };
}

/** Categories with a live product, for the nav and the home tiles. */
export async function listCategories() {
  return db.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      parentId: true,
      _count: { select: { products: { where: { status: "active" } } } },
    },
  });
}

export async function getCategoryBySlug(slug: string) {
  return db.category.findFirst({
    where: { slug, isActive: true },
    select: { id: true, name: true, slug: true, description: true },
  });
}

/** Home page shelves. One query each, run together. */
export async function homeShelves(memberPercent = 0) {
  const [featured, newest, banners] = await Promise.all([
    db.product.findMany({
      where: { status: "active", isFeatured: true, variants: { some: { isActive: true } } },
      select: cardSelect,
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 8,
    }),
    db.product.findMany({
      where: { status: "active", variants: { some: { isActive: true } } },
      select: cardSelect,
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 8,
    }),
    // liveWhere, not just isActive: a banner scheduled for December must not appear in
    // October, and one whose sale ended last week must stop on its own.
    db.banner.findMany({
      where: liveWhere(new Date(), "home_hero"),
      orderBy: { sortOrder: "asc" },
      take: 1,
    }),
  ]);

  return {
    featured: featured.map((row) => toCard(row, memberPercent)),
    newArrivals: newest.map((row) => toCard(row, memberPercent)),
    hero: banners[0] ?? null,
  };
}

// ─────────────────────────────  product detail  ─────────────────────────────

export interface DetailVariant {
  id: string;
  sku: string;
  name: string;
  priceCents: Cents;
  compareAtPriceCents: Cents | null;
  /** The member's price for this variant, or null when the viewer is not a verified member. */
  memberPriceCents: Cents | null;
  stockQty: number;
  lowStockThreshold: number;
  weightGrams: number;
  optionValues: Record<string, string> | null;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  description: string | null;
  memberOnly: boolean;
  category: { name: string; slug: string } | null;
  images: { id: string; url: string; alt: string | null }[];
  variants: DetailVariant[];
  reviews: {
    id: string;
    rating: number;
    title: string | null;
    body: string | null;
    authorName: string;
    createdAt: Date;
    verifiedPurchase: boolean;
  }[];
  ratingAverage: number | null;
  ratingCount: number;
}

/**
 * Everything the product page needs, in one query.
 *
 * Only active variants are returned, but out-of-stock ones are — docs/05 requires them shown
 * and disabled rather than hidden, so a customer can see the size exists and is coming back.
 * Only approved reviews, per docs/04.
 */
export async function getProductDetail(
  slug: string,
  memberPercent = 0
): Promise<ProductDetail | null> {
  const product = await db.product.findFirst({
    where: { slug, status: "active" },
    select: {
      id: true,
      name: true,
      slug: true,
      brand: true,
      description: true,
      memberOnly: true,
      category: { select: { name: true, slug: true } },
      images: { select: { id: true, url: true, alt: true }, orderBy: { sortOrder: "asc" } },
      variants: {
        where: { isActive: true },
        orderBy: { priceCents: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          priceCents: true,
          compareAtPriceCents: true,
          stockQty: true,
          lowStockThreshold: true,
          weightGrams: true,
          optionValues: true,
        },
      },
      reviews: {
        where: { status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          orderId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  if (!product) return null;

  const ratings = product.reviews.map((review) => review.rating);
  const ratingAverage =
    ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    description: product.description,
    memberOnly: product.memberOnly,
    category: product.category,
    images: product.images,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceCents: variant.priceCents,
      compareAtPriceCents:
        variant.compareAtPriceCents && variant.compareAtPriceCents > variant.priceCents
          ? variant.compareAtPriceCents
          : null,
      // Computed server-side from the session's member status. A client that could ask for
      // member prices would be a discount anyone can claim.
      memberPriceCents:
        memberPercent > 0 ? memberUnitPrice(variant.priceCents, memberPercent) : null,
      stockQty: variant.stockQty,
      lowStockThreshold: variant.lowStockThreshold,
      weightGrams: variant.weightGrams,
      optionValues: (variant.optionValues as Record<string, string> | null) ?? null,
    })),
    reviews: product.reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      // First name only. A review page is not a place to publish customers' full names.
      authorName: review.user.name.split(" ")[0] ?? "Customer",
      createdAt: review.createdAt,
      verifiedPurchase: Boolean(review.orderId),
    })),
    ratingAverage,
    ratingCount: ratings.length,
  };
}

/** Four products from the same category — docs/04. Falls back to featured when there is none. */
export async function relatedProducts(
  productId: string,
  categorySlug: string | null,
  memberPercent = 0
): Promise<CatalogCard[]> {
  const base: Prisma.ProductWhereInput = {
    status: "active",
    variants: { some: { isActive: true } },
    id: { not: productId },
  };

  const sameCategory = categorySlug
    ? await db.product.findMany({
        where: { ...base, category: { slug: categorySlug } },
        select: cardSelect,
        take: 4,
        orderBy: { publishedAt: "desc" },
      })
    : [];

  if (sameCategory.length >= 4 || !categorySlug) {
    return sameCategory.map((row) => toCard(row, memberPercent));
  }

  // Top up from featured rather than showing one lonely card.
  const filler = await db.product.findMany({
    where: { ...base, id: { notIn: [productId, ...sameCategory.map((p) => p.id)] } },
    select: cardSelect,
    take: 4 - sameCategory.length,
    orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }],
  });

  return [...sameCategory, ...filler].map((row) => toCard(row, memberPercent));
}

/** The price range across the live catalog, so the filter can bound itself to reality. */
export async function priceBounds(): Promise<{ minCents: number; maxCents: number }> {
  const result = await db.productVariant.aggregate({
    where: { isActive: true, product: { status: "active" } },
    _min: { priceCents: true },
    _max: { priceCents: true },
  });

  return {
    minCents: result._min.priceCents ?? 0,
    maxCents: result._max.priceCents ?? 0,
  };
}
