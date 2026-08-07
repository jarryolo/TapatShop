import type { Role } from "@tapatshop/shared";

/**
 * The admin sidebar, and who may see each entry.
 *
 * docs/01: staff get orders, inventory, and customers. Settings, staff management, and the
 * audit log are admin-only.
 *
 * This list controls what is *rendered*. It is not a security boundary — docs/02 is explicit
 * that middleware is a convenience and every admin route handler must re-check the role
 * server-side. Hiding a link stops nobody from typing the URL.
 */
export interface NavItem {
  label: string;
  href: string;
  /** Roles allowed to see this entry. */
  roles: readonly Role[];
}

const STAFF_AND_ADMIN = ["staff", "admin"] as const;
const ADMIN_ONLY = ["admin"] as const;

export const ADMIN_NAV: readonly NavItem[] = [
  { label: "Dashboard", href: "/admin", roles: STAFF_AND_ADMIN },
  { label: "Orders", href: "/admin/orders", roles: STAFF_AND_ADMIN },
  { label: "Products", href: "/admin/products", roles: STAFF_AND_ADMIN },
  { label: "Inventory", href: "/admin/inventory", roles: STAFF_AND_ADMIN },
  { label: "Customers", href: "/admin/customers", roles: STAFF_AND_ADMIN },
  // Admin-only: approving one of these moves an account to a different person's inbox.
  { label: "Account recovery", href: "/admin/recovery", roles: ADMIN_ONLY },
  // Admin-only and irreversible: it erases a customer and rewrites their order rows.
  { label: "Erasure requests", href: "/admin/deletion-requests", roles: ADMIN_ONLY },
  { label: "Coupons", href: "/admin/coupons", roles: STAFF_AND_ADMIN },
  { label: "Reviews", href: "/admin/reviews", roles: STAFF_AND_ADMIN },
  { label: "Content", href: "/admin/content", roles: STAFF_AND_ADMIN },
  { label: "Settings", href: "/admin/settings", roles: ADMIN_ONLY },
  { label: "Staff", href: "/admin/staff", roles: ADMIN_ONLY },
  { label: "Audit log", href: "/admin/audit-logs", roles: ADMIN_ONLY },
];

const ADMIN_ROOT = "/admin";

export function navFor(role: Role): NavItem[] {
  return ADMIN_NAV.filter((item) => item.roles.includes(role));
}

/**
 * Does this nav entry own this path?
 *
 * The dashboard sits at /admin, which is a prefix of every admin route. If it were allowed
 * to prefix-match, it would own every path in the product — every unlisted route would
 * inherit its staff-visible permission, and the dashboard link would look active everywhere.
 * So the root entry matches exactly and nothing else.
 */
function owns(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  if (item.href === ADMIN_ROOT) return false;
  return pathname.startsWith(`${item.href}/`);
}

/** The most specific entry that owns the path, or null if none does. */
function bestMatch(items: readonly NavItem[], pathname: string): NavItem | null {
  const matches = items.filter((item) => owns(item, pathname));
  if (matches.length === 0) return null;

  return matches.reduce((longest, item) =>
    item.href.length > longest.href.length ? item : longest
  );
}

/**
 * Whether a role may open a path. Fails closed.
 *
 * A path no nav entry claims is denied to everyone, including admins. That means adding an
 * admin page requires adding it here — deliberately. The alternative defaults every new
 * route to staff-visible, and nobody notices until a staff member opens the payouts page
 * that was added last week.
 */
export function canAccess(role: Role, pathname: string): boolean {
  const match = bestMatch(ADMIN_NAV, pathname);
  return match ? match.roles.includes(role) : false;
}

/** Marks the active sidebar entry. Same ownership rule, so exactly one entry lights up. */
export function isActive(itemHref: string, pathname: string, items: readonly NavItem[]): boolean {
  return bestMatch(items, pathname)?.href === itemHref;
}
