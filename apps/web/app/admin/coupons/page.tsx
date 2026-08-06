import type { Metadata } from "next";

import { StatCard } from "@/components/admin/stat-card";
import { db } from "@/lib/db";
import { listCouponsForAdmin } from "@/lib/services/coupon.service";
import { formatPeso } from "@/lib/utils/money";

import { CouponsView, type AdminCouponRow } from "./coupons-view";

export const metadata: Metadata = { title: "Coupons — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminCouponsPage() {
  const coupons = await listCouponsForAdmin(db);
  const now = new Date();

  const rows: AdminCouponRow[] = coupons.map((coupon) => ({
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    percentage: coupon.percentage,
    valueCents: coupon.valueCents,
    minSubtotalCents: coupon.minSubtotalCents,
    maxUses: coupon.maxUses,
    maxUsesPerUser: coupon.maxUsesPerUser,
    usedCount: coupon.usedCount,
    membersOnly: coupon.membersOnly,
    startsAt: coupon.startsAt?.toISOString() ?? null,
    endsAt: coupon.endsAt?.toISOString() ?? null,
    isActive: coupon.isActive,
    redemptionCount: coupon.redemptionCount,
    discountedCents: coupon.discountedCents,
  }));

  const live = rows.filter(
    (row) =>
      row.isActive &&
      (!row.startsAt || new Date(row.startsAt) <= now) &&
      (!row.endsAt || new Date(row.endsAt) >= now) &&
      (row.maxUses === null || row.usedCount < row.maxUses)
  ).length;

  const givenAway = rows.reduce((sum, row) => sum + row.discountedCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Coupons</h1>
        <p className="mt-1 text-sm text-text-muted">
          {rows.length} {rows.length === 1 ? "coupon" : "coupons"}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Coupons" value={String(rows.length)} />
        <StatCard label="Live now" value={String(live)} hint="Active, in date, and not used up" />
        <StatCard
          label="Given away"
          value={formatPeso(givenAway)}
          hint="Total discounted on paid orders"
        />
      </div>

      <CouponsView rows={rows} />
    </div>
  );
}
