import Link from "next/link";

import { StatCard } from "@/components/admin/stat-card";
import { FulfillmentStatusPill, PaymentStatusPill } from "@/components/admin/status-pill";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD, LOW_STOCK, ORDERS } from "@/lib/admin/fixtures";
import { formatDate } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

export default function AdminDashboardPage() {
  const awaitingAction = ORDERS.filter(
    (o) => o.paymentStatus === "paid" && o.fulfillmentStatus === "unfulfilled"
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">
          Reading fixture data until P1-05 wires up the database.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sales today"
          value={formatPeso(DASHBOARD.salesTodayCents)}
          hint="Paid orders only"
        />
        <StatCard label="Orders today" value={String(DASHBOARD.ordersToday)} />
        <StatCard
          label="Awaiting action"
          value={String(DASHBOARD.awaitingAction)}
          hint="Paid but not yet packed"
          tone="attention"
        />
        <StatCard
          label="Low stock"
          value={String(DASHBOARD.lowStockCount)}
          hint="At or below threshold"
          tone="attention"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders awaiting action</CardTitle>
            <Link
              href="/admin/orders"
              className="text-[13px] font-semibold text-brand-600 hover:underline"
            >
              All orders
            </Link>
          </CardHeader>

          <ul className="flex flex-col gap-3">
            {awaitingAction.map((order) => (
              <li key={order.orderNo} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{order.orderNo}</p>
                  <p className="truncate text-[13px] text-text-muted">
                    {order.customer} · {formatDate(order.placedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums">{formatPeso(order.totalCents)}</span>
                  <FulfillmentStatusPill status={order.fulfillmentStatus} />
                </div>
              </li>
            ))}
          </ul>
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

          <ul className="flex flex-col gap-3">
            {LOW_STOCK.map((item) => (
              <li key={item.sku} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.product}</p>
                  <p className="truncate text-[13px] text-text-muted">
                    {item.variant} · {item.sku}
                  </p>
                </div>
                <Badge tone="warning">{item.stockQty} left</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
        </CardHeader>
        <ul className="flex flex-col gap-3">
          {ORDERS.slice(0, 4).map((order) => (
            <li key={order.orderNo} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{order.orderNo}</p>
                <p className="truncate text-[13px] text-text-muted">{order.customer}</p>
              </div>
              <div className="flex items-center gap-2">
                <PaymentStatusPill status={order.paymentStatus} />
                <span className="tabular-nums">{formatPeso(order.totalCents)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
