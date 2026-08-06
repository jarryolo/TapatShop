import { Prisma, type PrismaClient, type ProductStatus } from "@tapatshop/db";

import { db } from "@/lib/db";

import { diff, log } from "./audit.service";

/**
 * Products, variants, and categories. Admin side.
 *
 * Two rules carry the weight here: a product cannot be published half-finished, and a SKU
 * collision must say which SKU collided rather than surfacing a Prisma error.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export interface Actor {
  id: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ─────────────────────────────  slugs  ─────────────────────────────

/** URL-safe slug. Strips accents so "Café" and "Cafe" do not become different products. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * A slug not already taken, by appending -2, -3 and so on.
 *
 * Two products called "Chapter jacket" is ordinary. Failing the save because of it is not,
 * and neither is silently overwriting the first one's URL.
 */
export async function uniqueSlug(tx: Db, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "product";

  for (let suffix = 1; suffix < 500; suffix++) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    const clash = await tx.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash || clash.id === excludeId) return candidate;
  }

  throw new Error(`Could not find a free slug for "${base}"`);
}

// ─────────────────────────────  publishability  ─────────────────────────────

export interface PublishProblem {
  field: string;
  message: string;
}

/**
 * Why a product cannot go live yet, in the order someone would fix them.
 *
 * Returned as a list rather than a boolean so the editor can show every blocker at once.
 * Fixing one thing, saving, and being told about the next is the kind of interaction that
 * makes people stop using an admin tool.
 */
export async function publishBlockers(tx: Db, productId: string): Promise<PublishProblem[]> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: { variants: true, images: { orderBy: { sortOrder: "asc" } } },
  });

  if (!product) return [{ field: "product", message: "That product no longer exists." }];

  const problems: PublishProblem[] = [];
  const activeVariants = product.variants.filter((v) => v.isActive);

  if (activeVariants.length === 0) {
    problems.push({
      field: "variants",
      message:
        "Add at least one variant. A product with no options still needs one, named Default.",
    });
  } else if (activeVariants.every((v) => v.priceCents <= 0)) {
    problems.push({
      field: "variants",
      message: "Set a price above zero on at least one variant.",
    });
  }

  const primary = product.images[0];
  if (!primary) {
    problems.push({ field: "images", message: "Add at least one image." });
  } else if (!primary.alt || primary.alt.trim().length === 0) {
    // docs/05: block publishing a product whose primary image has no alt text. It is the
    // one accessibility rule that is cheap to enforce and impossible to retrofit at scale.
    problems.push({
      field: "images",
      message: "The first image needs alt text describing what it shows.",
    });
  }

  if (!product.description || product.description.trim().length === 0) {
    problems.push({ field: "description", message: "Add a description." });
  }

  return problems;
}

// ─────────────────────────────  SKU collisions  ─────────────────────────────

/**
 * A duplicate SKU, if Prisma raised one.
 *
 * P2002 is the unique-constraint violation. Letting it reach the client would produce
 * "Unique constraint failed on the fields: (`sku`)", which tells a shop admin nothing about
 * which of the twelve rows in their variant matrix is the problem.
 */
export function duplicateSkuFrom(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
    if (fields.some((f) => f.toLowerCase().includes("sku"))) return "sku";
  }
  return null;
}

export type SkuCheck = { ok: true } | { ok: false; duplicates: string[]; message: string };

/**
 * Checks SKUs before writing, so the error names the offender.
 *
 * Covers both collisions inside the submitted batch and collisions with other products —
 * a variant matrix editor makes the first kind easy to create by accident.
 */
export async function checkSkus(
  tx: Db,
  skus: string[],
  excludeVariantIds: string[] = []
): Promise<SkuCheck> {
  const trimmed = skus.map((s) => s.trim()).filter((s) => s.length > 0);

  const seen = new Set<string>();
  const withinBatch = new Set<string>();
  for (const sku of trimmed) {
    const key = sku.toLowerCase();
    if (seen.has(key)) withinBatch.add(sku);
    seen.add(key);
  }

  const existing = await tx.productVariant.findMany({
    where: { sku: { in: trimmed }, id: { notIn: excludeVariantIds } },
    select: { sku: true },
  });

  const duplicates = [...new Set([...withinBatch, ...existing.map((v) => v.sku)])];
  if (duplicates.length === 0) return { ok: true };

  const list = duplicates.join(", ");
  return {
    ok: false,
    duplicates,
    message:
      duplicates.length === 1
        ? `The SKU ${list} is already in use. SKUs have to be unique across every product.`
        : `These SKUs are already in use: ${list}. SKUs have to be unique across every product.`,
  };
}

// ─────────────────────────────  products  ─────────────────────────────

export interface ProductInput {
  name: string;
  brand?: string | null;
  categoryId?: string | null;
  description?: string | null;
  isFeatured?: boolean;
  memberOnly?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export async function createProduct(tx: Db, actor: Actor, input: ProductInput) {
  const product = await tx.product.create({
    data: {
      name: input.name.trim(),
      slug: await uniqueSlug(tx, input.name),
      brand: input.brand?.trim() || null,
      categoryId: input.categoryId || null,
      description: input.description?.trim() || null,
      isFeatured: input.isFeatured ?? false,
      memberOnly: input.memberOnly ?? false,
      metaTitle: input.metaTitle?.trim() || null,
      metaDescription: input.metaDescription?.trim() || null,
      // Always draft. Publishing runs the checks in publishBlockers, and letting create
      // bypass them would be the one path that ships a product with no price.
      status: "draft",
    },
  });

  await log(tx, {
    actorId: actor.id,
    action: "product.create",
    entity: "Product",
    entityId: product.id,
    after: { name: product.name, slug: product.slug, status: product.status },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return product;
}

export async function updateProduct(
  tx: Db,
  actor: Actor,
  id: string,
  input: Partial<ProductInput>
) {
  const before = await tx.product.findUniqueOrThrow({ where: { id } });

  const data: Prisma.ProductUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.brand !== undefined) data.brand = input.brand?.trim() || null;
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
  if (input.memberOnly !== undefined) data.memberOnly = input.memberOnly;
  if (input.metaTitle !== undefined) data.metaTitle = input.metaTitle?.trim() || null;
  if (input.metaDescription !== undefined) {
    data.metaDescription = input.metaDescription?.trim() || null;
  }
  if (input.categoryId !== undefined) {
    data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  }

  const after = await tx.product.update({ where: { id }, data });

  // The slug is deliberately not regenerated on rename. A live product's URL is in search
  // results, in customers' history, and possibly on a printed flyer.
  const changed = diff(before as unknown as Record<string, unknown>, {
    ...(data as Record<string, unknown>),
    categoryId: input.categoryId,
  });

  await log(tx, {
    actorId: actor.id,
    action: "product.update",
    entity: "Product",
    entityId: id,
    before: changed.before,
    after: changed.after,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return after;
}

export type PublishResult =
  { kind: "ok"; status: ProductStatus } | { kind: "blocked"; problems: PublishProblem[] };

export async function publishProduct(tx: Db, actor: Actor, id: string): Promise<PublishResult> {
  const problems = await publishBlockers(tx, id);
  if (problems.length > 0) return { kind: "blocked", problems };

  const before = await tx.product.findUniqueOrThrow({ where: { id } });
  const product = await tx.product.update({
    where: { id },
    data: { status: "active", publishedAt: before.publishedAt ?? new Date() },
  });

  await log(tx, {
    actorId: actor.id,
    action: "product.publish",
    entity: "Product",
    entityId: id,
    before: { status: before.status },
    after: { status: product.status },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok", status: product.status };
}

export async function setProductStatus(
  tx: Db,
  actor: Actor,
  id: string,
  status: Exclude<ProductStatus, "active">
) {
  const before = await tx.product.findUniqueOrThrow({ where: { id } });
  const product = await tx.product.update({ where: { id }, data: { status } });

  await log(tx, {
    actorId: actor.id,
    action: status === "archived" ? "product.archive" : "product.unpublish",
    entity: "Product",
    entityId: id,
    before: { status: before.status },
    after: { status: product.status },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return product;
}

// ─────────────────────────────  variants  ─────────────────────────────

export interface VariantInput {
  id?: string;
  sku: string;
  name: string;
  priceCents: number;
  compareAtPriceCents?: number | null;
  costCents?: number | null;
  lowStockThreshold?: number;
  weightGrams?: number;
  isActive?: boolean;
  optionValues?: Record<string, string> | null;
}

export type VariantSaveResult =
  | { kind: "ok"; variantIds: string[] }
  | { kind: "duplicate-sku"; duplicates: string[]; message: string };

/**
 * Saves the variant matrix in one go: creates new rows, updates existing ones.
 *
 * Deliberately does NOT touch stockQty. Stock moves only through inventory_movements
 * (docs/CLAUDE.md), so a price edit cannot quietly rewrite the ledger's derived cache.
 */
export async function saveVariants(
  tx: Db,
  actor: Actor,
  productId: string,
  variants: VariantInput[]
): Promise<VariantSaveResult> {
  const existingIds = variants.map((v) => v.id).filter((id): id is string => Boolean(id));
  const check = await checkSkus(
    tx,
    variants.map((v) => v.sku),
    existingIds
  );
  if (!check.ok) {
    return { kind: "duplicate-sku", duplicates: check.duplicates, message: check.message };
  }

  const variantIds: string[] = [];

  for (const input of variants) {
    const shared = {
      sku: input.sku.trim(),
      name: input.name.trim(),
      priceCents: input.priceCents,
      compareAtPriceCents: input.compareAtPriceCents ?? null,
      costCents: input.costCents ?? null,
      lowStockThreshold: input.lowStockThreshold ?? 5,
      weightGrams: input.weightGrams ?? 0,
      isActive: input.isActive ?? true,
      optionValues: (input.optionValues ?? undefined) as Prisma.InputJsonValue | undefined,
    };

    if (input.id) {
      const before = await tx.productVariant.findUniqueOrThrow({ where: { id: input.id } });
      const after = await tx.productVariant.update({ where: { id: input.id }, data: shared });
      variantIds.push(after.id);

      const changed = diff(before as unknown as Record<string, unknown>, shared);
      if (Object.keys(changed.after).length > 0) {
        await log(tx, {
          actorId: actor.id,
          action: "variant.update",
          entity: "ProductVariant",
          entityId: after.id,
          before: changed.before,
          after: changed.after,
          ip: actor.ip,
          userAgent: actor.userAgent,
        });
      }
    } else {
      const created = await tx.productVariant.create({
        data: { ...shared, productId, stockQty: 0 },
      });
      variantIds.push(created.id);

      await log(tx, {
        actorId: actor.id,
        action: "variant.create",
        entity: "ProductVariant",
        entityId: created.id,
        after: { sku: created.sku, name: created.name, priceCents: created.priceCents },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
  }

  return { kind: "ok", variantIds };
}

export type VariantDeleteResult = { kind: "ok" } | { kind: "has-orders" };

/**
 * Removes a variant, unless it has been sold.
 *
 * OrderItem keeps a nullable variantId for reference, but inventory movements do not — and
 * deleting a sold variant would cascade its movement rows away, breaking invariant I4 for
 * every historical order. Deactivate instead.
 */
export async function deleteVariant(
  tx: Db,
  actor: Actor,
  variantId: string
): Promise<VariantDeleteResult> {
  const sold = await tx.orderItem.count({ where: { variantId } });
  if (sold > 0) return { kind: "has-orders" };

  const before = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  await tx.productVariant.delete({ where: { id: variantId } });

  await log(tx, {
    actorId: actor.id,
    action: "variant.delete",
    entity: "ProductVariant",
    entityId: variantId,
    before: { sku: before.sku, name: before.name },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok" };
}

// ─────────────────────────────  images  ─────────────────────────────

/**
 * Applies a new image order.
 *
 * The first image is the primary one shown on the product card, so this is a merchandising
 * decision, not a cosmetic one — which is why it is audited.
 */
export async function reorderImages(
  tx: Db,
  actor: Actor,
  productId: string,
  imageIdsInOrder: string[]
): Promise<void> {
  const images = await tx.productImage.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
  });

  const known = new Set(images.map((i) => i.id));
  const ordered = imageIdsInOrder.filter((id) => known.has(id));
  // Anything the client did not mention keeps its relative position at the end, so a stale
  // browser tab cannot silently drop an image that someone else just added.
  const remainder = images.filter((i) => !ordered.includes(i.id)).map((i) => i.id);
  const finalOrder = [...ordered, ...remainder];

  for (const [index, id] of finalOrder.entries()) {
    await tx.productImage.update({ where: { id }, data: { sortOrder: index } });
  }

  await log(tx, {
    actorId: actor.id,
    action: "image.reorder",
    entity: "Product",
    entityId: productId,
    before: { order: images.map((i) => i.id) },
    after: { order: finalOrder },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

export async function updateImageAlt(tx: Db, actor: Actor, imageId: string, alt: string) {
  const before = await tx.productImage.findUniqueOrThrow({ where: { id: imageId } });
  const after = await tx.productImage.update({
    where: { id: imageId },
    data: { alt: alt.trim() || null },
  });

  await log(tx, {
    actorId: actor.id,
    action: "image.update",
    entity: "ProductImage",
    entityId: imageId,
    before: { alt: before.alt },
    after: { alt: after.alt },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return after;
}

// ─────────────────────────────  categories  ─────────────────────────────

export interface CategoryInput {
  name: string;
  parentId?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export async function createCategory(tx: Db, actor: Actor, input: CategoryInput) {
  const category = await tx.category.create({
    data: {
      name: input.name.trim(),
      slug: await uniqueCategorySlug(tx, input.name),
      parentId: input.parentId || null,
      description: input.description?.trim() || null,
      imageUrl: input.imageUrl || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });

  await log(tx, {
    actorId: actor.id,
    action: "category.create",
    entity: "Category",
    entityId: category.id,
    after: { name: category.name, slug: category.slug },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return category;
}

async function uniqueCategorySlug(tx: Db, base: string): Promise<string> {
  const root = slugify(base) || "category";
  for (let suffix = 1; suffix < 500; suffix++) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    const clash = await tx.category.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error(`Could not find a free slug for "${base}"`);
}

export type CategoryDeleteResult = { kind: "ok" } | { kind: "has-products"; count: number };

/** Refuses to orphan products. Reassign or archive them first. */
export async function deleteCategory(
  tx: Db,
  actor: Actor,
  id: string
): Promise<CategoryDeleteResult> {
  const count = await tx.product.count({ where: { categoryId: id } });
  if (count > 0) return { kind: "has-products", count };

  const before = await tx.category.findUniqueOrThrow({ where: { id } });
  await tx.category.delete({ where: { id } });

  await log(tx, {
    actorId: actor.id,
    action: "category.delete",
    entity: "Category",
    entityId: id,
    before: { name: before.name, slug: before.slug },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok" };
}

// ─────────────────────────────  reads  ─────────────────────────────

export async function listProductsForAdmin(tx: Db = db) {
  return tx.product.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      category: { select: { name: true } },
      variants: { select: { id: true, priceCents: true, stockQty: true, isActive: true } },
      images: { select: { id: true }, take: 1, orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getProductForAdmin(id: string, tx: Db = db) {
  return tx.product.findUnique({
    where: { id },
    include: {
      category: true,
      variants: { orderBy: { name: "asc" } },
      images: { orderBy: { sortOrder: "asc" } },
    },
  });
}

/** Bound helpers for callers that do not need to compose a transaction. */
export const productService = {
  create: (actor: Actor, input: ProductInput) =>
    db.$transaction((tx) => createProduct(tx, actor, input)),
  update: (actor: Actor, id: string, input: Partial<ProductInput>) =>
    db.$transaction((tx) => updateProduct(tx, actor, id, input)),
  publish: (actor: Actor, id: string) => db.$transaction((tx) => publishProduct(tx, actor, id)),
  setStatus: (actor: Actor, id: string, status: Exclude<ProductStatus, "active">) =>
    db.$transaction((tx) => setProductStatus(tx, actor, id, status)),
  saveVariants: (actor: Actor, productId: string, variants: VariantInput[]) =>
    db.$transaction((tx) => saveVariants(tx, actor, productId, variants)),
  deleteVariant: (actor: Actor, variantId: string) =>
    db.$transaction((tx) => deleteVariant(tx, actor, variantId)),
  reorderImages: (actor: Actor, productId: string, ids: string[]) =>
    db.$transaction((tx) => reorderImages(tx, actor, productId, ids)),
  updateImageAlt: (actor: Actor, imageId: string, alt: string) =>
    db.$transaction((tx) => updateImageAlt(tx, actor, imageId, alt)),
  createCategory: (actor: Actor, input: CategoryInput) =>
    db.$transaction((tx) => createCategory(tx, actor, input)),
  deleteCategory: (actor: Actor, id: string) =>
    db.$transaction((tx) => deleteCategory(tx, actor, id)),
  publishBlockers: (id: string) => publishBlockers(db, id),
};
