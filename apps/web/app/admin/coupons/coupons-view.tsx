"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Column, DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

import { BLANK, CouponForm, type CouponDraft } from "./coupon-form";

export interface AdminCouponRow extends Record<string, unknown> {
  id: string;
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  percentage: number | null;
  valueCents: number | null;
  minSubtotalCents: number;
  maxUses: number | null;
  maxUsesPerUser: number;
  usedCount: number;
  membersOnly: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  redemptionCount: number;
  discountedCents: number;
}

/** What the coupon takes off, in one phrase. */
function describe(row: AdminCouponRow): string {
  if (row.type === "percentage") return `${row.percentage ?? 0}% off`;
  if (row.type === "fixed") return `${formatPeso(row.valueCents ?? 0)} off`;
  return "Free shipping";
}

/**
 * Why a coupon is not currently usable, or null if it is.
 *
 * `isActive` is only one of four ways a code can be dead, and an admin looking at a list of
 * "active" coupons wondering why a customer's code is refused deserves the real reason.
 */
function dormancy(row: AdminCouponRow, now: Date): string | null {
  if (!row.isActive) return "Off";
  if (row.startsAt && new Date(row.startsAt) > now) return "Scheduled";
  if (row.endsAt && new Date(row.endsAt) < now) return "Expired";
  if (row.maxUses !== null && row.usedCount >= row.maxUses) return "Used up";
  return null;
}

export function CouponsView({ rows }: { rows: AdminCouponRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<CouponDraft | null>(null);

  const now = new Date();

  async function retire(row: AdminCouponRow) {
    const used = row.redemptionCount > 0;
    const message = used
      ? `${row.code} has been used ${row.redemptionCount} times, so it will be switched off rather than deleted. Continue?`
      : `Delete ${row.code}? It has never been used, so nothing is lost.`;

    if (!window.confirm(message)) return;

    const response = await fetch(`/api/v1/admin/coupons/${row.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast("Could not retire that coupon.", "error");
      return;
    }

    toast(used ? "Coupon switched off." : "Coupon deleted.", "success");
    router.refresh();
  }

  function edit(row: AdminCouponRow) {
    setEditing({
      id: row.id,
      code: row.code,
      type: row.type,
      percentage: row.percentage,
      valueCents: row.valueCents,
      minSubtotalCents: row.minSubtotalCents,
      maxUses: row.maxUses,
      maxUsesPerUser: row.maxUsesPerUser,
      membersOnly: row.membersOnly,
      // datetime-local wants the seconds and zone gone.
      startsAt: row.startsAt?.slice(0, 16) ?? null,
      endsAt: row.endsAt?.slice(0, 16) ?? null,
      isActive: row.isActive,
    });
  }

  const columns: Column<AdminCouponRow>[] = [
    {
      key: "code",
      header: "Code",
      sortable: true,
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold tabular-nums">{row.code}</span>
          <span className="block truncate text-[13px] text-text-muted">{describe(row)}</span>
        </span>
      ),
    },
    {
      key: "isActive",
      header: "State",
      render: (row) => {
        const reason = dormancy(row, now);
        return reason ? <Badge>{reason}</Badge> : <Badge tone="success">Live</Badge>;
      },
    },
    {
      key: "membersOnly",
      header: "Who",
      secondary: true,
      render: (row) => (row.membersOnly ? <Badge tone="brand">Members</Badge> : "Everyone"),
    },
    {
      key: "minSubtotalCents",
      header: "Minimum",
      secondary: true,
      align: "right",
      render: (row) => (row.minSubtotalCents > 0 ? formatPeso(row.minSubtotalCents) : "—"),
    },
    {
      key: "usedCount",
      header: "Used",
      sortable: true,
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.usedCount}
          {row.maxUses !== null ? ` / ${row.maxUses}` : ""}
        </span>
      ),
    },
    {
      key: "discountedCents",
      header: "Given away",
      sortable: true,
      align: "right",
      render: (row) => formatPeso(row.discountedCents),
    },
    {
      key: "endsAt",
      header: "Ends",
      secondary: true,
      render: (row) => (row.endsAt ? formatDate(row.endsAt) : "—"),
    },
    {
      key: "id",
      header: "",
      align: "right",
      render: (row) => (
        <span className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => edit(row)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => retire(row)}>
            Retire
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ ...BLANK })}>New coupon</Button>
      </div>

      <DataTable
        caption="Coupons, with usage and what each has discounted"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        searchKeys={["code"]}
        searchPlaceholder="Search codes"
        perPage={20}
        emptyTitle="No coupons match that search"
        emptyBody="Try a different code."
      />

      {editing ? (
        <CouponForm
          open
          draft={editing}
          onClose={() => setEditing(null)}
          // Remounts on each open so a cancelled edit does not leak into the next one.
          key={editing.id ?? "new"}
        />
      ) : null}
    </>
  );
}
