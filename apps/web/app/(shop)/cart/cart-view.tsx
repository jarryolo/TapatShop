"use client";

import Link from "next/link";

import { CartLines } from "@/components/shop/cart-lines";
import { useCart } from "@/components/shop/cart-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatPeso } from "@/lib/utils/money";

export function CartView() {
  const { cart, update, remove, pending } = useCart();
  const { toast } = useToast();

  if (cart.lines.length === 0) {
    return (
      <Card className="p-0 md:p-0">
        <EmptyState
          title="Your cart is empty"
          body="Everything you add will wait here for 30 days, even if you close the browser."
          action={
            <Link href="/products" className="font-semibold text-brand-600 hover:underline">
              Browse the catalog
            </Link>
          }
        />
      </Card>
    );
  }

  /**
   * Blocking lines are the ones that cannot be bought at all.
   *
   * A reduced quantity is fine to check out with — the customer is charged for what exists.
   * An out-of-stock line has to go first, and the button says so rather than failing later.
   */
  const blocking = cart.lines.filter(
    (line) => line.issue?.kind === "out_of_stock" || line.issue?.kind === "unavailable"
  );

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <Card className="min-w-0 flex-1">
        {cart.hasIssues ? (
          <p
            role="status"
            className="mb-4 rounded-[var(--radius-ctrl)] border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm"
          >
            Something changed while this was in your cart. The notes below say what.
          </p>
        ) : null}

        <CartLines lines={cart.lines} onUpdate={update} onRemove={remove} pending={pending} />
      </Card>

      {/* Sticky on desktop, per the checkout layout rules in docs/05. */}
      <Card className="w-full lg:sticky lg:top-6 lg:w-80">
        <h2 className="text-lg font-semibold">Summary</h2>

        <dl className="mt-4 flex flex-col gap-2 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-text-muted">Subtotal</dt>
            <dd className="tabular-nums">{formatPeso(cart.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">Shipping</dt>
            <dd className="text-text-muted">Worked out at checkout</dd>
          </div>
        </dl>

        <div className="mt-4 flex justify-between border-t border-border-subtle pt-4 text-lg font-semibold">
          <span>Total so far</span>
          <span className="tabular-nums">{formatPeso(cart.subtotalCents)}</span>
        </div>

        <Button
          fullWidth
          className="mt-4"
          disabled={blocking.length > 0}
          onClick={() => toast("Checkout arrives in P3-02.", "info")}
        >
          {blocking.length > 0 ? "Remove unavailable items" : "Check out"}
        </Button>

        <p className="mt-3 text-[13px] text-text-muted">
          Prices are recalculated from the catalog every time you open this page.
        </p>
      </Card>
    </div>
  );
}
