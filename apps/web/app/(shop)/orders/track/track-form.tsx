"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

interface TrackedOrder {
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

export function TrackForm() {
  const [orderNo, setOrderNo] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setOrder(null);

    const response = await fetch(
      `/api/v1/orders/track?orderNo=${encodeURIComponent(orderNo)}&email=${encodeURIComponent(email)}`
    );
    const body = await response.json();
    setPending(false);

    if (!response.ok) {
      // Same message whether the order does not exist or the email does not match, so this
      // form cannot be used to discover which order numbers are real.
      setError(body.error?.message ?? "Something went wrong. Try again.");
      return;
    }

    setOrder(body.data);
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field id="orderNo" label="Order number" required hint="Like TS-2026-000123.">
            <Input
              id="orderNo"
              required
              value={orderNo}
              placeholder="TS-2026-000123"
              hint="Like TS-2026-000123."
              onChange={(event) => setOrderNo(event.target.value)}
            />
          </Field>

          <Field id="email" label="Email" required>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-ctrl)] border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={pending}>
            Find my order
          </Button>
        </form>
      </Card>

      {order ? (
        <Card className="flex flex-col gap-5">
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
          </div>
        </Card>
      ) : null}
    </div>
  );
}
