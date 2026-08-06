"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  FulfillmentStatusPill,
  type FulfillmentStatus,
  type OrderStatus,
  OrderStatusPill,
  type PaymentStatus,
  PaymentStatusPill,
} from "@/components/admin/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

interface OrderView {
  id: string;
  orderNo: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  refundedCents: number;
  couponCode: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  isGuest: boolean;
  memberNo: string | null;
  address: Record<string, string>;
  placedAt: string;
  items: {
    id: string;
    productName: string;
    variantName: string;
    sku: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
  }[];
  events: { id: string; type: string; message: string; isPublic: boolean; createdAt: string }[];
}

interface Transitions {
  status: string[];
  paymentStatus: string[];
  fulfillmentStatus: string[];
}

const LABELS: Record<string, string> = {
  confirmed: "Confirm",
  completed: "Mark completed",
  cancelled: "Cancel",
  packed: "Mark packed",
  unfulfilled: "Back to unfulfilled",
  shipped: "Mark shipped",
  delivered: "Mark delivered",
  returned: "Mark returned",
  paid: "Mark paid",
  failed: "Mark failed",
  refunded: "Mark refunded",
  partially_refunded: "Mark partially refunded",
  awaiting_payment: "Awaiting payment",
  unpaid: "Mark unpaid",
};

export function OrderDetail({
  order,
  transitions,
}: {
  order: OrderView;
  transitions: Transitions;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [carrier, setCarrier] = useState(order.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");

  async function move(axis: keyof Transitions, to: string) {
    // The one transition that needs a reason. Asking here beats a 422 round trip.
    let cancelReason: string | undefined;
    if (to === "cancelled") {
      cancelReason = window.prompt("Why is this order being cancelled?")?.trim() || undefined;
      if (!cancelReason) return;
    }

    setPending(to);
    const response = await fetch(`/api/v1/admin/orders/${order.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [axis]: to, cancelReason }),
    });
    setPending(null);

    const body = await response.json();
    if (!response.ok) {
      toast(body.error?.message ?? "Could not update the order.", "error");
      return;
    }

    toast("Order updated.", "success");
    router.refresh();
  }

  async function saveTracking() {
    setPending("tracking");
    const response = await fetch(`/api/v1/admin/orders/${order.id}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier, trackingNumber }),
    });
    setPending(null);

    const body = await response.json();
    if (!response.ok) {
      toast(body.error?.message ?? "Could not save the tracking number.", "error");
      return;
    }

    toast(
      order.trackingNumber
        ? "Tracking updated. No new email was sent."
        : "Marked shipped and the customer has been emailed.",
      "success"
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">
            {order.orderNo}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Placed {formatDateTime(order.placedAt)} · {order.isGuest ? "Guest" : "Account"}
            {order.memberNo ? ` · Member ${order.memberNo}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OrderStatusPill status={order.status} />
          <PaymentStatusPill status={order.paymentStatus} />
          <FulfillmentStatusPill status={order.fulfillmentStatus} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4 py-3 first:pt-0">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{item.productName}</span>
                    <span className="block truncate text-[13px] text-text-muted">
                      {item.variantName} · {item.sku} · {formatPeso(item.unitPriceCents)} ×{" "}
                      {item.quantity}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatPeso(item.lineTotalCents)}</span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 flex flex-col gap-1 border-t border-border-subtle pt-4 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-text-muted">Subtotal</dt>
                <dd className="tabular-nums">{formatPeso(order.subtotalCents)}</dd>
              </div>
              {order.discountCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-text-muted">
                    Discount {order.couponCode ? `(${order.couponCode})` : ""}
                  </dt>
                  <dd className="tabular-nums">−{formatPeso(order.discountCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-text-muted">Shipping</dt>
                <dd className="tabular-nums">{formatPeso(order.shippingCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-border-subtle pt-2 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPeso(order.totalCents)}</dd>
              </div>
              {order.refundedCents > 0 ? (
                <div className="flex justify-between text-warning-text">
                  <dt>Refunded</dt>
                  <dd className="tabular-nums">−{formatPeso(order.refundedCents)}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <ol className="flex flex-col gap-3">
              {order.events.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px]">{event.message}</span>
                      {/* Staff see both; the customer timeline filters the internal ones. */}
                      {!event.isPublic ? <Badge tone="neutral">Internal</Badge> : null}
                    </span>
                    <span className="block text-[13px] text-text-soft">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <p className="font-semibold">{order.customerName}</p>
            <p className="text-sm text-text-muted">{order.customerEmail}</p>
            <p className="text-sm text-text-muted">{order.customerPhone}</p>

            <p className="mt-4 text-[13px] font-semibold text-text-muted">Delivery address</p>
            <address className="mt-1 not-italic text-[15px]">
              {order.address.recipient ? (
                <span className="block">{order.address.recipient}</span>
              ) : null}
              <span className="block">{order.address.street}</span>
              <span className="block">
                {[order.address.barangay, order.address.city, order.address.province]
                  .filter(Boolean)
                  .join(", ")}
              </span>
              {order.address.postalCode ? (
                <span className="block">{order.address.postalCode}</span>
              ) : null}
            </address>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>

            <div className="flex flex-col gap-4">
              {(["status", "fulfillmentStatus", "paymentStatus"] as const).map((axis) =>
                transitions[axis].length > 0 ? (
                  <div key={axis}>
                    <p className="mb-2 text-[13px] font-semibold text-text-muted">
                      {axis === "status"
                        ? "Order"
                        : axis === "fulfillmentStatus"
                          ? "Fulfilment"
                          : "Payment"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {transitions[axis].map((to) => (
                        <Button
                          key={to}
                          size="sm"
                          variant={to === "cancelled" ? "danger" : "secondary"}
                          loading={pending === to}
                          onClick={() => void move(axis, to)}
                        >
                          {LABELS[to] ?? to}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null
              )}

              {transitions.status.length === 0 &&
              transitions.fulfillmentStatus.length === 0 &&
              transitions.paymentStatus.length === 0 ? (
                <p className="text-sm text-text-muted">
                  This order is in a final state. Nothing further can be changed.
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tracking</CardTitle>
            </CardHeader>
            <div className="flex flex-col gap-3">
              <Field id="carrier" label="Carrier">
                <Input
                  id="carrier"
                  value={carrier}
                  placeholder="J&T Express"
                  onChange={(event) => setCarrier(event.target.value)}
                />
              </Field>
              <Field id="trackingNumber" label="Tracking number">
                <Input
                  id="trackingNumber"
                  value={trackingNumber}
                  onChange={(event) => setTrackingNumber(event.target.value)}
                />
              </Field>
              <Button
                loading={pending === "tracking"}
                disabled={!carrier.trim() || !trackingNumber.trim()}
                onClick={saveTracking}
              >
                {order.trackingNumber ? "Update tracking" : "Save and mark shipped"}
              </Button>
              <p className="text-[13px] text-text-muted">
                {order.trackingNumber
                  ? "The shipped email has already gone out. Updating the number will not send another."
                  : "Saving marks the order shipped and emails the customer once."}
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
