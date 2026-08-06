import Link from "next/link";

import { StatCard } from "@/components/admin/stat-card";
import { FulfillmentStatusPill, PaymentStatusPill } from "@/components/admin/status-pill";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { manilaDateKey } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

export const dynamic = "force-dynamic";

/**
 * The admin dashboard, on live data.
 *
 * "Today" is the Manila calendar day, not the UTC one. An order placed at 7am Manila is
 * still yesterday in UTC, and a dashboard that misses eight hours of orders every morning
 * would be worse than no dashboard.
 */
async function todayRange(): Promise<{ start: Date; end: Date }> {
  const key = manilaDateKey(new Date());
  // Manila is UTC+8 with no daylight saving, so the offset is a constant.
  const start = new Date(`${key}T00:00:00+08:00`);
  const end = new Date(`${key}T23:59:59.999+08:00`);
  return { start, end };
}

export default async function AdminDashboardPage() {
  const { start, end } = await todayRange();

  const [salesToday, ordersToday, awaitingAction, lowStock, recent] = await Promise.all([
    // Paid orders only — an unpaid order is not revenue.
    db.order.aggregate({
      where: {
        paidAt: { gte: start, lte: end },
        paymentStatus: { in: ["paid", "partially_refunded"] },
      },
      _sum: { totalCents: true },
      _count: true,
    }),
    db.order.count({ where: { createdAt: { gte: start, lte: end } } }),
    db.order.findMany({
      where: {
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        status: { not: "cancelled" },
      },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        totalCents: true,
        fulfillmentStatus: true,
        createdAt: true,
      },
    }),
    db.productVariant.findMany({
      where: { isActive: true, product: { status: "active" } },
      orderBy: { stockQty: "asc" },
      take: 8,
      select: {
        id: true,
        sku: true,
        name: true,
        stockQty: true,
        lowStockThreshold: true,
        product: { select: { name: true, id: true } },
      },
    }),
    db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        totalCents: true,
        paymentStatus: true,
      },
    }),
  ]);

  const lowStockRows = lowStock.filter((v) => v.stockQty <= v.lowStockThreshold);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">Today is the Manila calendar day.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sales today"
          value={formatPeso(salesToday._sum.totalCents ?? 0)}
          hint={`${salesToday._count} paid ${salesToday._count === 1 ? "order" : "orders"}`}
        />
        <StatCard label="Orders today" value={String(ordersToday)} hint="Placed, paid or not" />
        <StatCard
          label="Awaiting action"
          value={String(awaitingAction.length)}
          hint="Paid but not yet packed"
          tone={awaitingAction.length > 0 ? "attention" : "default"}
        />
        <StatCard
          label="Low stock"
          value={String(lowStockRows.length)}
          hint="At or below threshold"
          tone={lowStockRows.length > 0 ? "attention" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders awaiting action</CardTitle>
            <Link
              href="/admin/orders?paymentStatus=paid&fulfillmentStatus=unfulfilled"
              className="text-[13px] font-semibold text-brand-600 hover:underline"
            >
              All orders
            </Link>
          </CardHeader>

          {awaitingAction.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing waiting. Everything paid is packed.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {awaitingAction.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3">
                  <Link href={`/admin/orders/${order.id}`} className="min-w-0 hover:text-brand-600">
                    <span className="block truncate font-semibold">{order.orderNo}</span>
                    <span className="block truncate text-[13px] text-text-muted">
                      {order.customerName}
                    </span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">{formatPeso(order.totalCents)}</span>
                    <FulfillmentStatusPill status={order.fulfillmentStatus} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Low stock</CardTitle>
            <Link
              href="/admin/inventory"
              className="text-[13px] font-semibold text-brand-600 hover:underline"
            >
              Inventory
            </Link>
          </CardHeader>

          {lowStockRows.length === 0 ? (
            <p className="text-sm text-text-muted">Everything is above its threshold.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {lowStockRows.map((variant) => (
                <li key={variant.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/admin/products/${variant.product.id}`}
                    className="min-w-0 hover:text-brand-600"
                  >
                    <span className="block truncate font-semibold">{variant.product.name}</span>
                    <span className="block truncate text-[13px] text-text-muted">
                      {variant.name} · {variant.sku}
                    </span>
                  </Link>
                  <Badge tone={variant.stockQty === 0 ? "danger" : "warning"}>
                    {variant.stockQty === 0 ? "Out of stock" : `${variant.stockQty} left`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
        </CardHeader>
        <ul className="flex flex-col gap-3">
          {recent.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center justify-between gap-3">
              <Link href={`/admin/orders/${order.id}`} className="min-w-0 hover:text-brand-600">
                <span className="block truncate font-semibold">{order.orderNo}</span>
                <span className="block truncate text-[13px] text-text-muted">
                  {order.customerName}
                </span>
              </Link>
              <span className="flex items-center gap-2">
                <PaymentStatusPill status={order.paymentStatus} />
                <span className="tabular-nums">{formatPeso(order.totalCents)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
