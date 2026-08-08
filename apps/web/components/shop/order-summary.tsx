import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

/**
 * One order as a customer sees it: what was bought, what it cost, where it is.
 *
 * Shared by guest tracking and the signed-in account area. It was inline in the tracking form
 * first; the account order detail needs exactly the same thing, and two copies would drift in
 * the direction that matters least — one of them quietly showing a field the other withholds.
 *
 * Everything here comes from the order's own snapshot columns, never from live product rows
 * (CLAUDE.md invariant 4). A product renamed, repriced, or deleted since must not change what
 * this says was bought.
 */

export interface CustomerOrder {
  orderNo: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  carrier: string | null;
  trackingNumber: string | null;
  customerName: string;
  items: {
    id: string;
    productName: string;
    variantName: string;
    quantity: number;
    lineTotalCents: number;
  }[];
  events: { id: string; type: string; message: string; createdAt: string }[];
}

export function OrderSummary({ order }: { order: CustomerOrder }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{order.orderNo}</h2>
          <p className="text-sm text-text-muted">{order.customerName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={order.paymentStatus === "paid" ? "success" : "warning"}>
            {order.paymentStatus.replace(/_/g, " ")}
          </Badge>
          <Badge tone={order.fulfillmentStatus === "delivered" ? "success" : "neutral"}>
            {order.fulfillmentStatus}
          </Badge>
        </div>
      </div>

      {order.trackingNumber ? (
        <div className="rounded-[var(--radius-ctrl)] bg-page p-3 text-sm">
          <p className="font-semibold">
            {order.carrier} · {order.trackingNumber}
          </p>
          <p className="mt-1 text-text-muted">Use this number on the courier&rsquo;s site.</p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2 text-[15px]">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4">
            <span className="min-w-0">
              <span className="block truncate">{item.productName}</span>
              <span className="block text-[13px] text-text-muted">
                {item.variantName} × {item.quantity}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{formatPeso(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-1 border-t border-border-subtle pt-3 text-[15px]">
        <div className="flex justify-between">
          <dt className="text-text-muted">Subtotal</dt>
          <dd className="tabular-nums">{formatPeso(order.subtotalCents)}</dd>
        </div>
        {order.discountCents > 0 ? (
          <div className="flex justify-between text-success-text">
            <dt>Discount</dt>
            <dd className="tabular-nums">−{formatPeso(order.discountCents)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="text-text-muted">Shipping</dt>
          <dd className="tabular-nums">
            {order.shippingCents === 0 ? "Free" : formatPeso(order.shippingCents)}
          </dd>
        </div>
        <div className="mt-1 flex justify-between border-t border-border-subtle pt-2 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatPeso(order.totalCents)}</dd>
        </div>
      </dl>

      {/* Public events only — internal notes never reach this list. */}
      <div>
        <h3 className="mb-2 font-semibold">Timeline</h3>
        {order.events.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing to show yet. Updates appear here as the order moves.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {order.events.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" />
                <span>
                  <span className="block text-[15px]">{event.message}</span>
                  <span className="block text-[13px] text-text-soft">
                    {formatDateTime(event.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
