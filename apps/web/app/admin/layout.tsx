import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Sidebar } from "@/components/admin/sidebar";
import { requireRole } from "@/lib/api/guard";
import { db } from "@/lib/db";

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
  // requireRole, not requireStaff: a page render has no Request to key a rate limit on, and
  // limiting page loads would throttle an admin for scrolling. The API behind it is limited.
  const guard = await requireRole("staff", "admin");
  if (!guard.ok) redirect("/signin?next=/admin");

  /**
   * Enrolled, or nothing else — P5-03.
   *
   * Sent to the enrolment page rather than to sign-in, because they are signed in; bouncing
   * them to a form they have already filled in correctly would be a loop with no exit.
   *
   * The page lives under /account rather than /admin for the same reason — inside this layout
   * it would redirect to itself.
   */
  const enrolled = await db.user.findUnique({
    where: { id: guard.actor.id },
    select: { totpEnabledAt: true },
  });
  if (!enrolled?.totpEnabledAt) redirect("/account/two-factor");

  return (
    <div className="lg:flex">
      <Sidebar role={guard.actor.role} />
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
      </div>
    </div>
  );
}
