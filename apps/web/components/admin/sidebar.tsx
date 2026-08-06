"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { Role } from "@tapatshop/shared";

import { isActive, navFor } from "@/lib/admin/nav";
import { cn } from "@/lib/utils/cn";

/**
 * Admin navigation. Left rail on desktop, a collapsible drawer on mobile.
 *
 * The entries are filtered by role, but that is presentation only — docs/02 is explicit that
 * middleware is a convenience and every admin route handler re-checks the role server-side.
 * A hidden link stops nobody from typing the URL.
 */
export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navFor(role);

  const links = (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(item.href, pathname, items);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={cn(
                "flex min-h-11 items-center rounded-[var(--radius-ctrl)] px-3 text-[15px]",
                active
                  ? "bg-brand-50 font-semibold text-brand-800"
                  : "text-text-muted hover:bg-page hover:text-text"
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-3 lg:hidden">
        <Link href="/admin" className="font-semibold">
          TapatShop admin
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="admin-nav"
          className="min-h-11 rounded-[var(--radius-ctrl)] border border-border-strong px-3 text-[13px] font-semibold"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      <nav
        id="admin-nav"
        aria-label="Admin"
        className={cn(
          "border-b border-border-subtle bg-surface px-3 py-3 lg:block lg:h-dvh lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r",
          open ? "block" : "hidden"
        )}
      >
        <Link href="/admin" className="mb-4 hidden px-3 text-lg font-semibold lg:block">
          TapatShop admin
        </Link>
        {links}

        <p className="mt-6 px-3 text-xs text-text-soft">Signed in as {role}</p>
      </nav>
    </>
  );
}
