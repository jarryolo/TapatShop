"use client";

import { useRouter } from "next/navigation";

import { type Column, DataTable } from "@/components/admin/data-table";
import {
  FulfillmentStatusPill,
  type FulfillmentStatus,
  type OrderStatus,
  OrderStatusPill,
  type PaymentStatus,
  PaymentStatusPill,
} from "@/components/admin/status-pill";
import { formatDate } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

export interface AdminOrderRow extends Record<string, unknown> {
  id: string;
  orderNo: string;
  customer: string;
  email: string;
  placedAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  totalCents: number;
  itemCount: number;
  tracking: string | null;
}

export function OrdersTable({ rows }: { rows: AdminOrderRow[] }) {
  const router = useRouter();

  const columns: Column<AdminOrderRow>[] = [
    {
      key: "orderNo",
      header: "Order",
      sortable: true,
      render: (row) => <span className="font-semibold">{row.orderNo}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      sortable: true,
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate">{row.customer}</span>
          <span className="block truncate text-[13px] text-text-muted">{row.email}</span>
        </span>
      ),
    },
    {
      key: "placedAt",
      header: "Placed",
      sortable: true,
      secondary: true,
      render: (row) => formatDate(row.placedAt),
    },
    { key: "status", header: "Status", render: (row) => <OrderStatusPill status={row.status} /> },
    {
      key: "paymentStatus",
      header: "Payment",
      render: (row) => <PaymentStatusPill status={row.paymentStatus} />,
    },
    {
      key: "fulfillmentStatus",
      header: "Fulfilment",
      secondary: true,
      render: (row) => <FulfillmentStatusPill status={row.fulfillmentStatus} />,
    },
    {
      key: "totalCents",
      header: "Total",
      sortable: true,
      align: "right",
      render: (row) => formatPeso(row.totalCents),
    },
  ];

  return (
    <DataTable
      caption="Orders, with status, payment state and total"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      searchKeys={["orderNo", "customer", "email", "tracking"]}
      searchPlaceholder="Search order number, customer, email or tracking"
      perPage={20}
      onRowActivate={(row) => router.push(`/admin/orders/${row.id}`)}
      emptyTitle="No orders match that search"
      emptyBody="Try a different order number, name or email."
    />
  );
}
