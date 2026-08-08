import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderSummary } from "@/components/shop/order-summary";
import { Card } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { accountService } from "@/lib/services/account.service";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Order — TapatShop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface ShippingAddress {
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  region?: string;
  postalCode?: string;
}

export default async function AccountOrderPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const { orderNo } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?callbackUrl=/account/orders/${orderNo}`);

  const order = await accountService.orderFor(session.user.id, orderNo);

  // Someone else's order number is a 404, not a 403 — otherwise this page reports which order
  // numbers exist to anyone who tries a few.
  if (!order) notFound();

  const address = (order.shippingAddress ?? {}) as ShippingAddress;

  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 md:px-6 md:py-12">
      <Link href="/account/orders" className="text-[15px] font-semibold text-brand-600">
        ← All orders
      </Link>

      <Card className="mt-4">
        <OrderSummary
          order={{
            ...order,
            events: order.events.map((event) => ({
              ...event,
              createdAt: event.createdAt.toISOString(),
            })),
          }}
        />
      </Card>

      <Card className="mt-4">
        <h2 className="font-semibold">Delivery address</h2>
        {/*
          The address frozen onto the order, not the customer's current one. Invariant 4: this
          is where it went, which is the question being asked, and it must not silently change
          when they later edit their address book.
        */}
        <address className="mt-2 not-italic text-[15px] text-text-muted">
          {[address.street, address.barangay, address.city, address.province, address.postalCode]
            .filter(Boolean)
            .join(", ") || "No address recorded."}
        </address>

        {order.placedAt ? (
          <p className="mt-4 text-sm text-text-soft">Placed {formatDateTime(order.placedAt)}.</p>
        ) : (
          <p className="mt-4 text-sm text-text-soft">
            Not paid yet, so this order has not been placed.
          </p>
        )}
      </Card>
    </div>
  );
}
