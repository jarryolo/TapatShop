import Link from "next/link";

import { StatCard } from "@/components/admin/stat-card";
import { FulfillmentStatusPill, PaymentStatusPill } from "@/components/admin/status-pill";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import {
  awaitingActionSample,
  dashboardFigures,
  lowStockSample,
  recentOrders,
  topProductsThisWeek,
} from "@/lib/services/dashboard.service";
import { formatPeso } from "@/lib/utils/money";

export const dynamic = "force-dynamic";

/**
 * The admin dashboard, on live data.
 *
 * Every number comes from dashboard.service, where it is counted rather than inferred from
 * the length of the list beside it. The lists here are samples of at most eight rows; the
 * counts are the real totals, and the two are deliberately separate.
 */
export default async function AdminDashboardPage() {
  const now = new Date();

  const [figures, awaitingAction, lowStockRows, topProducts, recent] = await Promise.all([
    dashboardFigures(db, now),
    awaitingActionSample(db),
    lowStockSample(db),
    topProductsThisWeek(db, now),
    recentOrders(db),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">Today is the Manila calendar day.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sales today"
          value={formatPeso(figures.salesTodayCents)}
          hint={`${figures.paidOrdersToday} paid ${figures.paidOrdersToday === 1 ? "order" : "orders"}, less refunds`}
        />
        <StatCard
          label="Orders today"
          value={String(figures.ordersPlacedToday)}
          hint="Placed, paid or not"
        />
        <StatCard
          label="Awaiting action"
          value={String(figures.awaitingActionCount)}
          hint="Paid but not yet packed"
          tone={figures.awaitingActionCount > 0 ? "attention" : "default"}
        />
        <StatCard
          label="Low stock"
          value={String(figures.lowStockCount)}
          hint={
            figures.outOfStockCount > 0
              ? `${figures.outOfStockCount} out of stock`
              : "At or below threshold"
          }
          tone={figures.lowStockCount > 0 ? "attention" : "default"}
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
              {/* Says so when this is a sample. A truncated list with no hint reads as the
                  whole queue, which is how a backlog goes unnoticed. */}
              {figures.awaitingActionCount > awaitingAction.length
                ? `See all ${figures.awaitingActionCount}`
                : "All orders"}
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
              href="/admin/inventory?lowStock=true"
              className="text-[13px] font-semibold text-brand-600 hover:underline"
            >
              {figures.lowStockCount > lowStockRows.length
                ? `See all ${figures.lowStockCount}`
                : "Inventory"}
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
          <CardTitle>Top products this week</CardTitle>
          <span className="text-[13px] text-text-muted">By units sold on paid orders</span>
        </CardHeader>

        {topProducts.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing has sold in the last seven days.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {topProducts.map((entry) => (
              <li key={entry.variantId} className="flex items-center justify-between gap-3">
                <Link
                  href={`/admin/products/${entry.productId}`}
                  className="min-w-0 hover:text-brand-600"
                >
                  <span className="block truncate font-semibold">{entry.productName}</span>
                  <span className="block truncate text-[13px] text-text-muted">
                    {entry.variantName} · {entry.sku}
                  </span>
                </Link>
                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                  <span className="font-semibold">{entry.unitsSold} sold</span>
                  <span className="text-[13px] text-text-muted">
                    {formatPeso(entry.revenueCents)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

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
