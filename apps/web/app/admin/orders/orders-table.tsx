"use client";

import { type Column, DataTable } from "@/components/admin/data-table";
import {
  FulfillmentStatusPill,
  OrderStatusPill,
  PaymentStatusPill,
} from "@/components/admin/status-pill";
import { useToast } from "@/components/ui/toast";
import { type AdminOrderRow, ORDERS } from "@/lib/admin/fixtures";
import { formatDate } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

const columns: Column<AdminOrderRow>[] = [
  {
    key: "orderNo",
    header: "Order",
    sortable: true,
    render: (row) => <span className="font-semibold">{row.orderNo}</span>,
  },
  { key: "customer", header: "Customer", sortable: true },
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

export function OrdersTable() {
  const { toast } = useToast();

  return (
    <DataTable
      caption="Orders, with status, payment state, and total"
      rows={ORDERS}
      columns={columns}
      rowKey={(row) => row.orderNo}
      searchKeys={["orderNo", "customer"]}
      searchPlaceholder="Search order number or customer"
      perPage={5}
      emptyTitle="No orders match that search"
      emptyBody="Try a different order number or customer name."
      // Order detail is P4-01. Until then, activating a row proves the keyboard path works.
      onRowActivate={(row) => toast(`Order detail is P4-01. You picked ${row.orderNo}.`, "info")}
    />
  );
}
