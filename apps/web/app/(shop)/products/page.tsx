import type { Metadata } from "next";
import Link from "next/link";

import { CatalogListing } from "@/components/shop/catalog-listing";
import { auth } from "@/lib/auth";
import { listCatalog, memberDiscountPercent, priceBounds } from "@/lib/services/catalog.service";
import { listingCanonical, pageMetadata } from "@/lib/seo";
import { parseCatalogQuery } from "@/lib/validators/catalog";

/**
 * Canonical drops the filters and keeps the page number — see `listingCanonical`.
 *
 * Also `robots: noindex` once a search term is involved: a search results page is generated on
 * demand from someone else's query, and indexing those creates an unbounded set of thin pages
 * that all say "no results" a week later.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const page = Number(params.page ?? "1");

  return {
    ...pageMetadata({
      title: page > 1 ? `All products, page ${page}` : "All products",
      description: "Member-made goods, branded merchandise, books and food products.",
      path: "/products",
    }),
    alternates: { canonical: listingCanonical("/products", params) },
    ...(params.q ? { robots: { index: false, follow: true } } : {}),
  };
}

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

        {/* Say when the search was corrected. Silently returning results for a different
            word than the one typed is confusing, and the customer may want the literal one. */}
        {page.correctedTo ? (
          <p className="mt-1 text-sm text-text-muted">
            No exact matches. Showing results close to{" "}
            <span className="font-semibold text-text">{page.correctedTo}</span>.
          </p>
        ) : null}

        {query.q && page.meta.total === 0 ? (
          <p className="mt-1 text-sm text-text-muted">
            Nothing matched that. Try a shorter word, or{" "}
            <Link href="/products" className="font-semibold text-brand-600 hover:underline">
              browse everything
            </Link>
            .
          </p>
        ) : null}
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
