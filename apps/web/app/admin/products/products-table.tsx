"use client";

import { useRouter } from "next/navigation";

import { type Column, DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { formatPeso } from "@/lib/utils/money";

export interface ProductRow extends Record<string, unknown> {
  id: string;
  name: string;
  brand: string;
  category: string;
  status: "draft" | "active" | "archived";
  variantCount: number;
  priceCents: number;
  stockQty: number;
  hasImage: boolean;
}

const STATUS_TONE = {
  draft: "neutral",
  active: "success",
  archived: "warning",
} as const;

export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const router = useRouter();

  const columns: Column<ProductRow>[] = [
    {
      key: "name",
      header: "Product",
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-semibold">{row.name}</span>
          {/* A product with no image cannot be published, so surface it in the list. */}
          {!row.hasImage ? <Badge tone="warning">No image</Badge> : null}
        </span>
      ),
    },
    { key: "brand", header: "Brand", sortable: true, secondary: true },
    { key: "category", header: "Category", sortable: true, secondary: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
    },
    { key: "variantCount", header: "Variants", sortable: true, align: "right", secondary: true },
    {
      key: "stockQty",
      header: "Stock",
      sortable: true,
      align: "right",
      render: (row) => (
        <span className={row.stockQty === 0 ? "text-danger-text" : undefined}>{row.stockQty}</span>
      ),
    },
    {
      key: "priceCents",
      header: "From",
      sortable: true,
      align: "right",
      render: (row) => formatPeso(row.priceCents),
    },
  ];

  return (
    <DataTable
      caption="Products, with status, variant count, stock and price"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      searchKeys={["name", "brand", "category"]}
      searchPlaceholder="Search name, brand or category"
      perPage={15}
      onRowActivate={(row) => router.push(`/admin/products/${row.id}`)}
      emptyTitle="No products match that search"
      emptyBody="Try a different name, brand or category."
    />
  );
}
