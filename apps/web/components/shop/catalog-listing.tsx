import { ProductCard, ProductGrid } from "@/components/shop/product-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import type { CatalogPage } from "@/lib/services/catalog.service";

import { CatalogFilters, type Bounds, SortSelect } from "./catalog-controls";

/**
 * The listing shell: filter rail, sort, grid, pagination.
 *
 * Shared by /products and every category page so the two cannot drift apart.
 */
export function CatalogListing({
  page,
  bounds,
  basePath,
  searchParams,
  showMemberPrice,
}: {
  page: CatalogPage;
  bounds: Bounds;
  basePath: string;
  searchParams: Record<string, string | undefined>;
  showMemberPrice: boolean;
}) {
  /** Builds a page link that keeps every other filter — losing them on page 2 is a classic. */
  function hrefFor(target: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== "page") params.set(key, value);
    }
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <CatalogFilters bounds={bounds} />

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted" role="status" aria-live="polite">
            {page.meta.total} {page.meta.total === 1 ? "product" : "products"}
          </p>
          <SortSelect />
        </div>

        {page.data.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            body="Try widening the price range, or clear the filters to see everything."
          />
        ) : (
          <>
            <ProductGrid>
              {page.data.map((product) => (
                <ProductCard key={product.id} product={product} showMemberPrice={showMemberPrice} />
              ))}
            </ProductGrid>

            <Pagination
              className="mt-8"
              current={page.meta.page}
              total={page.meta.totalPages}
              hrefFor={hrefFor}
            />
          </>
        )}
      </div>
    </div>
  );
}
