import type { Metadata } from "next";

import { CatalogListing } from "@/components/shop/catalog-listing";
import { auth } from "@/lib/auth";
import { listCatalog, memberDiscountPercent, priceBounds } from "@/lib/services/catalog.service";
import { parseCatalogQuery } from "@/lib/validators/catalog";

export const metadata: Metadata = {
  title: "All products — TapatShop",
  description: "Member-made goods, branded merchandise, books and food products.",
};

// Catalog pages are cached for five minutes and revalidated by tag on product update —
// docs/02. The member price is per-viewer, so a signed-in member's page is dynamic.
export const revalidate = 300;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const query = parseCatalogQuery(params);

  const [session, percent, bounds] = await Promise.all([
    auth(),
    memberDiscountPercent(),
    priceBounds(),
  ]);

  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);

  const page = await listCatalog(
    {
      q: query.q,
      minPriceCents: query.minPrice,
      maxPriceCents: query.maxPrice,
      inStockOnly: query.inStock,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    },
    isMember ? percent : 0
  );

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">
          {query.q ? `Results for "${query.q}"` : "All products"}
        </h1>
      </header>

      <CatalogListing
        page={page}
        bounds={bounds}
        basePath="/products"
        searchParams={params}
        showMemberPrice={isMember}
      />
    </div>
  );
}
