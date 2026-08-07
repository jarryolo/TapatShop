import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_NAV } from "./nav";

/**
 * Every admin-only page must check the role itself, not just rely on middleware.
 *
 * This exists because the opposite happened. Rewriting `middleware.ts` to add security headers
 * silently replaced the path gate — passing a callback to `auth()` supersedes the `authorized`
 * callback rather than running after it — and for the length of that mistake staff could open
 * /admin/settings and /admin/audit-logs. The API refused them, because route handlers re-check
 * server-side; the pages did not, because they never had.
 *
 * A static check rather than an HTTP one on purpose: it fails at `pnpm test` on the commit that
 * adds an unguarded page, rather than the next time someone happens to try it as staff.
 */

const APP_DIR = join(process.cwd(), "apps/web/app");
const ADMIN_DIR = join(APP_DIR, "admin");

/** Route segments the nav marks admin-only, as directory names under app/admin. */
const ADMIN_ONLY_SEGMENTS = ADMIN_NAV.filter(
  (item) => item.roles.length === 1 && item.roles[0] === "admin"
).map((item) => item.href.replace("/admin/", ""));

function pagesUnder(dir: string): string[] {
  let found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found = found.concat(pagesUnder(full));
    else if (entry === "page.tsx") found.push(full);
  }
  return found;
}

describe("admin-only pages", () => {
  it("has at least one admin-only section, or this test proves nothing", () => {
    expect(ADMIN_ONLY_SEGMENTS.length).toBeGreaterThan(0);
  });

  for (const segment of ADMIN_ONLY_SEGMENTS) {
    const dir = join(ADMIN_DIR, segment);

    it(`/admin/${segment} checks the role server-side on every page`, () => {
      let pages: string[];
      try {
        pages = pagesUnder(dir);
      } catch {
        // The nav lists a section that has no pages yet. Nothing to guard.
        return;
      }

      expect(pages.length).toBeGreaterThan(0);

      for (const page of pages) {
        const source = readFileSync(page, "utf8");
        const guarded =
          source.includes("requireAdminPage()") ||
          source.includes('requireRole("admin")') ||
          source.includes("requireAdmin(");

        expect(guarded, `${page} renders admin-only content with no server-side role check`).toBe(
          true
        );
      }
    });
  }
});
