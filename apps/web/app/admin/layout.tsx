import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Sidebar } from "@/components/admin/sidebar";
import { CURRENT_ROLE } from "@/lib/admin/fixtures";

export const metadata: Metadata = {
  title: "Admin — TapatShop",
  robots: { index: false, follow: false },
};

/**
 * The admin shell.
 *
 * NOT YET GATED. `CURRENT_ROLE` is a fixture because Auth.js arrives in P1-05. When it does,
 * this layout reads the session, redirects anyone who is not staff or admin, and
 * middleware.ts gates /admin/* by path prefix. Until then these pages are open to anyone who
 * knows the URL, which is fine locally and must not ship.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:flex">
      <Sidebar role={CURRENT_ROLE} />
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
      </div>
    </div>
  );
}
