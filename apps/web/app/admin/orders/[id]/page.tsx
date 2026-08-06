import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ButtonLink } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getOrderForAdmin } from "@/lib/services/admin-orders.service";
import { allowedNext } from "@/lib/services/order.service";

import { OrderDetail } from "./order-detail";

export const metadata: Metadata = { title: "Order — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrderForAdmin(db, id);
  if (!order) notFound();

  const address = (order.shippingAddress ?? {}) as Record<string, string>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb
          items={[{ label: "Orders", href: "/admin/orders" }, { label: order.orderNo }]}
        />
        <ButtonLink href={`/admin/orders/${order.id}/packing-slip`} variant="secondary" size="sm">
          Packing slip
        </ButtonLink>
      </div>

      <OrderDetail
        order={{
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          subtotalCents: order.subtotalCents,
          shippingCents: order.shippingCents,
          discountCents: order.discountCents,
          totalCents: order.totalCents,
          refundedCents: order.refundedCents,
          couponCode: order.couponCode,
          carrier: order.carrier,
          trackingNumber: order.trackingNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone,
          isGuest: order.userId === null,
          memberNo: order.user?.memberNo ?? null,
          address,
          placedAt: order.createdAt.toISOString(),
          items: order.items.map((item) => ({
            id: item.id,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            unitPriceCents: item.unitPriceCents,
            quantity: item.quantity,
            lineTotalCents: item.lineTotalCents,
          })),
          events: order.events.map((event) => ({
            id: event.id,
            type: event.type,
            message: event.message,
            isPublic: event.isPublic,
            createdAt: event.createdAt.toISOString(),
          })),
        }}
        /**
         * The UI is handed exactly what the state machine permits, so it cannot offer a
         * button the server would refuse — docs/03.
         */
        transitions={{
          status: [...allowedNext("status", order.status)],
          paymentStatus: [...allowedNext("paymentStatus", order.paymentStatus)],
          fulfillmentStatus: [...allowedNext("fulfillmentStatus", order.fulfillmentStatus)],
        }}
      />
    </div>
  );
}
