import type { Metadata } from "next";

import { requireAdminPage } from "@/lib/api/guard";
import { staffService } from "@/lib/services/staff.service";

import { StaffView } from "./staff-view";

export const metadata: Metadata = { title: "Staff — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  // Admin only. Re-checked here, not just in middleware, per docs/02.
  const actor = await requireAdminPage();

  const members = await staffService.list();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Staff</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Who can open the admin portal. Staff see orders, products, inventory, customers, coupons,
          reviews and content. Admins additionally see settings, this page, account recovery,
          erasure requests and the audit log.
        </p>
      </header>

      <StaffView
        members={members.map((member) => ({
          ...member,
          disabledAt: member.disabledAt?.toISOString() ?? null,
          createdAt: member.createdAt.toISOString(),
        }))}
        currentUserId={actor.id}
      />
    </div>
  );
}
