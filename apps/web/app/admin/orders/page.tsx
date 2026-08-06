import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { db } from "@/lib/db";
import { listOrdersForAdmin } from "@/lib/services/admin-orders.service";

import { OrdersTable, type AdminOrderRow } from "./orders-table";

export const metadata: Metadata = { title: "Orders — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  const { data, meta } = await listOrdersForAdmin(db, {
    q: params.q,
    status: params.status as never,
    paymentStatus: params.paymentStatus as never,
    fulfillmentStatus: params.fulfillmentStatus as never,
    limit: 200,
  });

  const rows: AdminOrderRow[] = data.map((order) => ({
    id: order.id,
    orderNo: order.orderNo,
    customer: order.customerName,
    email: order.customerEmail,
    placedAt: order.createdAt.toISOString(),
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    totalCents: order.totalCents,
    itemCount: order._count.items,
    tracking: order.trackingNumber,
  }));

  // The export link carries the same filters, so what you download is what you are looking at.
  const exportQuery = new URLSearchParams();
  for (const key of ["q", "status", "paymentStatus", "fulfillmentStatus"]) {
    const value = params[key];
    if (value) exportQuery.set(key, value);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Orders</h1>
          <p className="mt-1 text-sm text-text-muted">
            {meta.total} {meta.total === 1 ? "order" : "orders"}
          </p>
        </div>
        <ButtonLink
          href={`/api/v1/admin/orders/export${exportQuery.size > 0 ? `?${exportQuery}` : ""}`}
          variant="secondary"
        >
          Export CSV
        </ButtonLink>
      </header>

      <OrdersTable rows={rows} />
    </div>
  );
}
