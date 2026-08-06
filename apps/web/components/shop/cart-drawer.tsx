"use client";

import Link from "next/link";

import { CartLines } from "@/components/shop/cart-lines";
import { useCart } from "@/components/shop/cart-provider";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/modal";
import { formatPeso } from "@/lib/utils/money";

/** The cart drawer, and the header button that opens it. */
export function CartButton() {
  const { cart, setOpen } = useCart();

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-ctrl)] px-3 text-[15px] font-semibold text-brand-600 hover:bg-brand-50"
    >
      Cart
      {cart.itemCount > 0 ? (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
          {cart.itemCount}
        </span>
      ) : null}
      <span className="sr-only-live">
        {cart.itemCount === 0 ? "Cart is empty" : `${cart.itemCount} items in cart`}
      </span>
    </button>
  );
}

export function CartDrawer() {
  const { cart, open, setOpen, update, remove, pending } = useCart();

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Your cart"
      footer={
        cart.lines.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Subtotal</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatPeso(cart.subtotalCents)}
              </span>
            </div>
            <p className="text-[13px] text-text-muted">
              Shipping is worked out at checkout, before you pay.
            </p>
            <ButtonLink href="/cart" fullWidth onClick={() => setOpen(false)}>
              View cart and check out
            </ButtonLink>
          </div>
        ) : null
      }
    >
      {cart.lines.length === 0 ? (
        <EmptyState
          title="Your cart is empty"
          body="Everything you add will wait here for 30 days."
          action={
            <Link href="/products" className="font-semibold text-brand-600 hover:underline">
              Browse the catalog
            </Link>
          }
        />
      ) : (
        <>
          {cart.hasIssues ? (
            <p
              role="status"
              className="mb-3 rounded-[var(--radius-ctrl)] border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm"
            >
              Something changed while this was in your cart. Check the notes below.
            </p>
          ) : null}
          <CartLines
            lines={cart.lines}
            onUpdate={update}
            onRemove={remove}
            pending={pending}
            compact
          />
        </>
      )}
    </Sheet>
  );
}
