"use client";

import { useRouter } from "next/navigation";

import { type Column, DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

export interface AdminCustomerRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  memberNo: string | null;
  chapter: string | null;
  isMember: boolean;
  orderCount: number;
  lifetimeValueCents: number;
  joinedAt: string;
}

export function CustomersTable({ rows }: { rows: AdminCustomerRow[] }) {
  const router = useRouter();

  const columns: Column<AdminCustomerRow>[] = [
    {
      key: "name",
      header: "Customer",
      sortable: true,
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{row.name}</span>
          <span className="block truncate text-[13px] text-text-muted">{row.email}</span>
        </span>
      ),
    },
    {
      key: "isMember",
      header: "Member",
      render: (row) =>
        row.isMember ? (
          <Badge tone="brand">{row.memberNo ?? "Verified"}</Badge>
        ) : (
          // Not a warning. Most customers are not brothers, and that is normal.
          <span className="text-[13px] text-text-muted">—</span>
        ),
    },
    { key: "chapter", header: "Chapter", secondary: true, render: (row) => row.chapter ?? "—" },
    {
      key: "orderCount",
      header: "Orders",
      sortable: true,
      align: "right",
      render: (row) => row.orderCount,
    },
    {
      key: "lifetimeValueCents",
      header: "Lifetime value",
      sortable: true,
      align: "right",
      render: (row) => formatPeso(row.lifetimeValueCents),
    },
    {
      key: "joinedAt",
      header: "Joined",
      sortable: true,
      secondary: true,
      render: (row) => formatDate(row.joinedAt),
    },
  ];

  return (
    <DataTable
      caption="Customers, with member status and lifetime value"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      searchKeys={["name", "email", "memberNo", "chapter"]}
      searchPlaceholder="Search name, email, member number or chapter"
      perPage={20}
      onRowActivate={(row) => router.push(`/admin/customers/${row.id}`)}
      emptyTitle="No customers match that search"
      emptyBody="Try a different name, email or member number."
    />
  );
}
