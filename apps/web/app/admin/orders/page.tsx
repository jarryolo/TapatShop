import type { Metadata } from "next";

import { OrdersTable } from "./orders-table";

export const metadata: Metadata = {
  title: "Orders — TapatShop admin",
};

export default function AdminOrdersPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Orders</h1>
        <p className="mt-1 text-sm text-text-muted">
          Sort by any column, search by order number or customer. Arrow keys move between rows.
        </p>
      </header>

      <OrdersTable />
    </div>
  );
}
