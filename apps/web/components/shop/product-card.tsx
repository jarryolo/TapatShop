import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { CatalogCard } from "@/lib/services/catalog.service";
import { cn } from "@/lib/utils/cn";
import { formatPeso } from "@/lib/utils/money";

/**
 * The most-repeated element in the product. docs/05 — get it right once.
 *
 * The whole card is one link. An "Add to cart" button lands inside it in P2-04, and the
 * nested-action problem docs/05 warns about is why the card is an anchor wrapping content
 * rather than a div with an onClick: a nested button can then stopPropagation cleanly, and
 * middle-click still opens the product in a new tab.
 */
export function ProductCard({
  product,
  showMemberPrice = false,
}: {
  product: CatalogCard;
  showMemberPrice?: boolean;
}) {
  const isLowStock = product.stockQty > 0 && product.stockQty <= product.lowStockThreshold;
  const isOutOfStock = product.stockQty === 0;

  // Members see their price as the price. Guests and non-members see no hint that one
  // exists — docs/01 is explicit that dangling an unavailable discount is off limits.
  const price =
    showMemberPrice && product.memberPriceCents ? product.memberPriceCents : product.priceCents;

  return (
    <Link
      href={`/products/${product.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]",
        "transition-shadow duration-150 ease-[var(--ease-out-soft)] hover:shadow-[var(--shadow-raised)]"
      )}
    >
      <div className="relative aspect-square w-full bg-white">
        {/*
          Plain <img> for now. next/image wants a configured loader and an allowlisted host,
          both of which arrive with the media pipeline in P1-06 — and there are no real image
          files to optimise until then. Swap this the moment uploads exist; it is the single
          biggest LCP lever on a catalog page.
        */}
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.imageAlt ?? product.name}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid size-full place-items-center bg-page text-text-soft">
            <svg viewBox="0 0 48 48" className="size-10" fill="none" aria-hidden="true">
              <rect
                x="6"
                y="10"
                width="36"
                height="28"
                rx="3"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path
                d="M6 30l9-8 7 6 6-5 14 11"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="sr-only-live">No image yet</span>
          </div>
        )}

        {/* Stock badge top-left, warning tint — docs/05. Only when it is true. */}
        {isOutOfStock ? (
          <span className="absolute left-2 top-2">
            <Badge tone="neutral">Out of stock</Badge>
          </span>
        ) : isLowStock ? (
          <span className="absolute left-2 top-2">
            <Badge tone="warning">{product.stockQty} left</Badge>
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3 md:p-4">
        {product.brand ? <span className="text-xs text-text-muted">{product.brand}</span> : null}

        <h3 className="line-clamp-2 text-[15px] font-semibold group-hover:text-brand-600">
          {product.name}
        </h3>

        <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-2">
          <span className="font-semibold">{formatPeso(price)}</span>

          {product.compareAtPriceCents ? (
            <span className="text-[13px] text-text-soft line-through">
              <span className="sr-only-live">Was </span>
              {formatPeso(product.compareAtPriceCents)}
            </span>
          ) : null}

          {showMemberPrice && product.memberPriceCents ? (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
              Member
            </span>
          ) : null}
        </div>

        {product.variantCount > 1 ? (
          <span className="text-xs text-text-muted">{product.variantCount} options</span>
        ) : null}
      </div>
    </Link>
  );
}

/** 2-up on mobile, 4-up on desktop — docs/05. */
export function ProductGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-4">{children}</div>;
}
