import type { Metadata } from "next";

import { StatCard } from "@/components/admin/stat-card";
import { requireAdminPage } from "@/lib/api/guard";
import { db } from "@/lib/db";
import { listDeletionRequests } from "@/lib/services/privacy.service";

import { RequestsView, type RequestRow } from "./requests-view";

export const metadata: Metadata = { title: "Erasure requests — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminDeletionRequestsPage() {
  // Admin only. Re-checked here, not just in middleware, per docs/02.
  await requireAdminPage();

  const requests = await listDeletionRequests(db);

  /**
   * How many of each person's orders are still on the way.
   *
   * Shown because erasing removes the delivery address from the order — if the courier needs
   * re-briefing afterwards there is nothing left to brief them with. One grouped query, not
   * one per request.
   */
  const openByUser = await db.order.groupBy({
    by: ["userId"],
    where: {
      userId: { in: requests.map((request) => request.userId) },
      status: { not: "cancelled" },
      fulfillmentStatus: { notIn: ["delivered", "returned"] },
    },
    _count: true,
  });
  const openCounts = new Map(openByUser.map((row) => [row.userId, row._count]));

  const rows: RequestRow[] = requests.map((request) => ({
    id: request.id,
    status: request.status,
    reason: request.reason,
    note: request.note,
    createdAt: request.createdAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    reviewerName: request.reviewer?.name ?? null,
    userId: request.user.id,
    userName: request.user.name,
    userEmail: request.user.email,
    userRole: request.user.role,
    openOrders: openCounts.get(request.userId) ?? 0,
  }));

  const waiting = rows.filter((row) => row.status === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Erasure requests</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Data Privacy Act requests. Erasing removes the customer&rsquo;s personal details
          everywhere and keeps their orders with those details stripped — the sales record has to
          survive for the BIR. It cannot be undone.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Waiting"
          value={String(waiting)}
          tone={waiting > 0 ? "attention" : "default"}
        />
        <StatCard label="All requests" value={String(rows.length)} />
      </div>

      <RequestsView rows={rows} />
    </div>
  );
}
