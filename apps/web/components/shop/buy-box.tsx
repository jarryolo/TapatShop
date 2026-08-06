"use client";

import { useState } from "react";

import { useCart } from "@/components/shop/cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import type { DetailVariant } from "@/lib/services/catalog.service";
import { cn } from "@/lib/utils/cn";

/**
 * Variant selection, stock state, and the add-to-cart action.
 *
 * Everything the customer changes here is client state over data the server already sent, so
 * picking a size updates the price, SKU, stock line and image with no round trip.
 */
export function BuyBox({
  variants,
  isMember,
  onVariantChange,
}: {
  variants: DetailVariant[];
  isMember: boolean;
  onVariantChange?: (variant: DetailVariant) => void;
}) {
  const { add, pending } = useCart();

  // Opens on the first variant that can actually be bought. Landing on a sold-out size when
  // another is available makes the whole product look unavailable.
  const firstAvailable = variants.find((variant) => variant.stockQty > 0) ?? variants[0];
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? "");
  const [quantity, setQuantity] = useState(1);

  const selected = variants.find((variant) => variant.id === selectedId) ?? firstAvailable;
  if (!selected) return null;

  const outOfStock = selected.stockQty === 0;
  const lowStock = selected.stockQty > 0 && selected.stockQty <= selected.lowStockThreshold;
  const maxQuantity = Math.max(1, selected.stockQty);

  function select(variant: DetailVariant) {
    setSelectedId(variant.id);
    setQuantity((current) => Math.min(current, Math.max(1, variant.stockQty)));
    onVariantChange?.(variant);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Price
          cents={
            isMember && selected.memberPriceCents ? selected.memberPriceCents : selected.priceCents
          }
          compareAtCents={selected.compareAtPriceCents}
          isMemberPrice={isMember && Boolean(selected.memberPriceCents)}
          size="lg"
        />
        <p className="mt-1 text-[13px] text-text-muted">
          SKU <span className="font-medium text-text">{selected.sku}</span>
        </p>
      </div>

      {variants.length > 1 ? (
        <fieldset className="border-0 p-0">
          <legend className="mb-2 text-sm font-semibold">Options</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const soldOut = variant.stockQty === 0;
              const isSelected = variant.id === selected.id;

              return (
                <label
                  key={variant.id}
                  className={cn(
                    "relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-ctrl)] border px-3 text-[15px]",
                    "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600",
                    isSelected
                      ? "border-brand-600 bg-brand-50 font-semibold text-brand-800"
                      : "border-border-strong hover:border-brand-400",
                    // Visibly disabled, never hidden — docs/05. A customer needs to see the
                    // size exists so they know to come back for it.
                    soldOut && "cursor-not-allowed border-border-subtle text-text-soft line-through"
                  )}
                >
                  <input
                    type="radio"
                    name="variant"
                    value={variant.id}
                    checked={isSelected}
                    disabled={soldOut}
                    onChange={() => select(variant)}
                    className="sr-only-live"
                  />
                  {variant.name}
                  {soldOut ? <span className="text-xs no-underline">(sold out)</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {/* Stock line. A live region so a screen reader hears it change with the variant. */}
      <p role="status" aria-live="polite" className="text-sm">
        {outOfStock ? (
          <Badge tone="neutral">Out of stock</Badge>
        ) : lowStock ? (
          <Badge tone="warning">Only {selected.stockQty} left</Badge>
        ) : (
          <span className="text-success-text">In stock</span>
        )}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="quantity" className="mb-1 block text-sm font-semibold">
            Quantity
          </label>
          <div className="inline-flex items-center rounded-[var(--radius-ctrl)] border border-border-strong">
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={quantity <= 1 || outOfStock}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="size-11 text-lg disabled:cursor-not-allowed disabled:text-text-soft"
            >
              −
            </button>
            <input
              id="quantity"
              inputMode="numeric"
              value={quantity}
              disabled={outOfStock}
              onChange={(event) => {
                const next = Number(event.target.value.replace(/\D/g, "")) || 1;
                // Clamped to what exists. The server re-checks at checkout regardless —
                // this is a courtesy, not the guard.
                setQuantity(Math.min(Math.max(1, next), maxQuantity));
              }}
              className="h-11 w-12 border-x border-border-strong text-center tabular-nums"
            />
            <button
              type="button"
              aria-label="Increase quantity"
              disabled={quantity >= maxQuantity || outOfStock}
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              className="size-11 text-lg disabled:cursor-not-allowed disabled:text-text-soft"
            >
              +
            </button>
          </div>
        </div>

        <Button
          size="lg"
          disabled={outOfStock}
          loading={pending}
          className="flex-1"
          onClick={() => void add(selected.id, quantity)}
        >
          {outOfStock ? "Out of stock" : "Add to cart"}
        </Button>
      </div>

      <p className="text-[13px] text-text-muted">
        Metro Manila in 1 to 3 days. Free shipping over ₱2,500.
      </p>
    </div>
  );
}
