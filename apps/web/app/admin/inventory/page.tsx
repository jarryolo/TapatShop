import type { Metadata } from "next";

import { db } from "@/lib/db";
import { stockList } from "@/lib/services/inventory.service";

import { InventoryView, type StockRow } from "./inventory-view";

export const metadata: Metadata = { title: "Inventory — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminInventoryPage() {
  const rows = await stockList(db);

  const data: StockRow[] = rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    productId: row.product.id,
    productName: row.product.name,
    variantName: row.name,
    stockQty: row.stockQty,
    reserved: row.reserved,
    available: row.available,
    lowStockThreshold: row.lowStockThreshold,
    isLow: row.isLow,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Inventory</h1>
        <p className="mt-1 text-sm text-text-muted">
          {data.filter((row) => row.isLow).length} of {data.length} at or below their threshold.
          Stock only ever changes through a movement, so every number here has a history.
        </p>
      </header>

      <InventoryView rows={data} />
    </div>
  );
}
