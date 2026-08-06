import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Sidebar } from "@/components/admin/sidebar";
import { requireStaff } from "@/lib/api/guard";

export const metadata: Metadata = {
  title: "Admin — TapatShop",
  robots: { index: false, follow: false },
};

/**
 * The admin shell, gated for real.
 *
 * Three layers, and each is load-bearing:
 *   1. middleware.ts turns a customer away at the edge before any of this renders
 *   2. this layout redirects anyone who is not staff or admin
 *   3. every admin route handler calls requireStaff/requireAdmin itself
 *
 * The third is the one that matters. docs/02: middleware is a convenience, not a boundary.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const guard = await requireStaff();
  if (!guard.ok) redirect("/signin?next=/admin");

  return (
    <div className="lg:flex">
      <Sidebar role={guard.actor.role} />
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
      </div>
    </div>
  );
}
