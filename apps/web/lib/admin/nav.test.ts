import { describe, expect, it } from "vitest";

import { ADMIN_NAV, canAccess, isActive, navFor } from "./nav";

describe("navFor", () => {
  it("gives admins everything", () => {
    expect(navFor("admin")).toHaveLength(ADMIN_NAV.length);
  });

  it("gives staff a reduced nav", () => {
    const labels = navFor("staff").map((item) => item.label);

    expect(labels).toContain("Orders");
    expect(labels).toContain("Inventory");
    expect(labels).toContain("Customers");

    expect(labels).not.toContain("Settings");
    expect(labels).not.toContain("Staff");
    expect(labels).not.toContain("Audit log");
  });

  it("gives customers nothing", () => {
    expect(navFor("customer")).toEqual([]);
  });
});

describe("canAccess", () => {
  it("lets staff into the shared sections", () => {
    expect(canAccess("staff", "/admin")).toBe(true);
    expect(canAccess("staff", "/admin/orders")).toBe(true);
    expect(canAccess("staff", "/admin/orders/TS-2026-000102")).toBe(true);
  });

  it("keeps staff out of the admin-only sections", () => {
    expect(canAccess("staff", "/admin/settings")).toBe(false);
    expect(canAccess("staff", "/admin/staff")).toBe(false);
    expect(canAccess("staff", "/admin/audit-logs")).toBe(false);
  });

  it("uses the longest prefix, so settings subpages stay admin-only", () => {
    // Both /admin and /admin/settings prefix-match this path. Picking the shorter one would
    // make every settings subpage staff-visible.
    expect(canAccess("staff", "/admin/settings/shipping")).toBe(false);
    expect(canAccess("admin", "/admin/settings/shipping")).toBe(true);
  });

  it("fails closed on a path no nav entry claims", () => {
    // /admin prefixes every admin route. If the dashboard entry were allowed to prefix-match,
    // an unlisted route like /admin/payouts would silently inherit its staff permission.
    expect(canAccess("admin", "/admin/payouts")).toBe(false);
    expect(canAccess("staff", "/admin/payouts")).toBe(false);
    expect(canAccess("admin", "/account")).toBe(false);
  });

  it("still allows the dashboard itself", () => {
    expect(canAccess("staff", "/admin")).toBe(true);
    expect(canAccess("admin", "/admin")).toBe(true);
  });

  it("never lets a customer in", () => {
    for (const item of ADMIN_NAV) {
      expect(canAccess("customer", item.href)).toBe(false);
    }
  });
});

describe("isActive", () => {
  const items = navFor("admin");

  it("marks the exact match", () => {
    expect(isActive("/admin/orders", "/admin/orders", items)).toBe(true);
  });

  it("marks the section for a nested path", () => {
    expect(isActive("/admin/orders", "/admin/orders/TS-2026-000102", items)).toBe(true);
  });

  it("does not leave the dashboard lit on every page", () => {
    // /admin prefixes every admin route. Without longest-prefix matching, Dashboard would
    // appear active no matter where you are.
    expect(isActive("/admin", "/admin/orders", items)).toBe(false);
    expect(isActive("/admin", "/admin", items)).toBe(true);
  });

  it("marks exactly one item at a time", () => {
    for (const pathname of ["/admin", "/admin/orders", "/admin/settings/shipping"]) {
      const active = items.filter((item) => isActive(item.href, pathname, items));
      expect(active).toHaveLength(1);
    }
  });
});
