import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CatalogListing } from "@/components/shop/catalog-listing";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { auth } from "@/lib/auth";
import {
  getCategoryBySlug,
  listCatalog,
  memberDiscountPercent,
  priceBounds,
} from "@/lib/services/catalog.service";
import { parseCatalogQuery } from "@/lib/validators/catalog";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Not found — TapatShop" };

  return {
    title: `${category.name} — TapatShop`,
    description: category.description ?? undefined,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const parsed = parseCatalogQuery(query);
  const [session, percent, bounds] = await Promise.all([
    auth(),
    memberDiscountPercent(),
    priceBounds(),
  ]);

  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);

  const page = await listCatalog(
    {
      categorySlug: slug,
      q: parsed.q,
      minPriceCents: parsed.minPrice,
      maxPriceCents: parsed.maxPrice,
      inStockOnly: parsed.inStock,
      sort: parsed.sort,
      page: parsed.page,
      limit: parsed.limit,
    },
    isMember ? percent : 0
  );

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: "Home", href: "/" },
          { label: "All products", href: "/products" },
          { label: category.name },
        ]}
      />

      <header className="mb-6">
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">{category.name}</h1>
        {category.description ? (
          <p className="mt-1 max-w-2xl text-text-muted">{category.description}</p>
        ) : null}
      </header>

      <CatalogListing
        page={page}
        bounds={bounds}
        basePath={`/c/${slug}`}
        searchParams={query}
        showMemberPrice={isMember}
      />
    </div>
  );
}
