import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { auth } from "@/lib/auth";
import { accountService } from "@/lib/services/account.service";
import { formatDateTime } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "Your orders — TapatShop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Payment first, delivery second.
 *
 * "Awaiting payment" is the state a customer can do something about, so it leads. A paid order
 * that has not shipped shows its fulfilment state instead, which is the next thing they want.
 */
const PAYMENT_TONES: Record<string, BadgeTone> = {
  paid: "success",
  pending: "warning",
  failed: "danger",
  refunded: "neutral",
  partially_refunded: "neutral",
};

const FULFILLMENT_TONES: Record<string, BadgeTone> = {
  delivered: "success",
  shipped: "brand",
  unfulfilled: "neutral",
  cancelled: "neutral",
};

export default async function AccountOrdersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?callbackUrl=/account/orders");

  const orders = await accountService.listOrders(session.user.id);

  return (
    <div className="mx-auto max-w-[880px] px-4 py-8 md:px-6 md:py-12">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Your orders</h1>
        <p className="mt-1 text-text-muted">Newest first. Open one for its full timeline.</p>
      </header>

      {orders.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            title="No orders yet"
            body="Anything you buy while signed in shows up here. If you ordered as a guest, track it with your order number."
            action={
              <Link href="/orders/track" className="font-semibold text-brand-600">
                Track an order
              </Link>
            }
          />
        </Card>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.orderNo}>
              <Link
                href={`/account/orders/${order.orderNo}`}
                className="block rounded-[var(--radius-card)] border border-border-subtle bg-surface p-4 hover:border-brand-600 md:p-5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-semibold">{order.orderNo}</span>

                  {order.paymentStatus === "paid" ? (
                    <Badge tone={FULFILLMENT_TONES[order.fulfillmentStatus] ?? "neutral"}>
                      {order.fulfillmentStatus.replace(/_/g, " ")}
                    </Badge>
                  ) : (
                    <Badge tone={PAYMENT_TONES[order.paymentStatus] ?? "warning"}>
                      {order.paymentStatus === "pending"
                        ? "awaiting payment"
                        : order.paymentStatus.replace(/_/g, " ")}
                    </Badge>
                  )}

                  <span className="ml-auto font-semibold tabular-nums">
                    {formatPeso(order.totalCents)}
                  </span>
                </div>

                <p className="mt-1 text-sm text-text-muted">
                  {formatDateTime(order.placedAt ?? order.createdAt)} —{" "}
                  {order.itemCount === 1 ? "1 item" : `${order.itemCount} items`}
                  {order.firstItemName ? `, including ${order.firstItemName}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
