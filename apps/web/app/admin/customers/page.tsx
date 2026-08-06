import type { Metadata } from "next";

import { StatCard } from "@/components/admin/stat-card";
import { db } from "@/lib/db";
import { listCustomers } from "@/lib/services/customer.service";
import { formatPeso } from "@/lib/utils/money";

import { CustomersTable, type AdminCustomerRow } from "./customers-table";

export const metadata: Metadata = { title: "Customers — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const customers = await listCustomers(db, { membersOnly: params.members === "1" });

  const rows: AdminCustomerRow[] = customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    memberNo: customer.memberNo,
    chapter: customer.chapter,
    isMember: customer.isMember,
    orderCount: customer.orderCount,
    lifetimeValueCents: customer.lifetimeValueCents,
    joinedAt: customer.createdAt.toISOString(),
  }));

  const members = rows.filter((row) => row.isMember).length;
  const revenue = rows.reduce((sum, row) => sum + row.lifetimeValueCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Customers</h1>
        <p className="mt-1 text-sm text-text-muted">
          {rows.length} {rows.length === 1 ? "customer" : "customers"}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Customers" value={String(rows.length)} />
        <StatCard
          label="Verified members"
          value={String(members)}
          hint="Verified by an admin, never self-declared"
        />
        <StatCard
          label="Lifetime value"
          value={formatPeso(revenue)}
          hint="Paid orders, less refunds"
        />
      </div>

      <CustomersTable rows={rows} />
    </div>
  );
}
