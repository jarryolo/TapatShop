import type { Prisma, PrismaClient } from "@tapatshop/db";
import type { Role } from "@tapatshop/shared";

import { db } from "@/lib/db";

import { log } from "./audit.service";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Who works here, and what they may reach — P1-07.
 *
 * The sidebar has linked to /admin/staff since the admin shell was built, and docs/01 lists
 * staff management as one of the three things that separate an admin from staff. The page
 * behind it was never written, so the link 404'd.
 *
 * ## What this deliberately cannot do
 *
 * It changes a role. It does not create accounts, and it never touches a password — CLAUDE.md
 * is explicit that an admin can neither read nor set one, so promoting someone means promoting
 * an account they already registered and control. That is also the safer shape: there is no
 * path here that mints a privileged account out of nothing.
 */

export interface StaffMember {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  twoFactorEnabled: boolean;
  disabledAt: Date | null;
  createdAt: Date;
}

/**
 * Everyone who is not a customer, plus anyone searched for by email.
 *
 * Listing all customers here would be the wrong screen — /admin/customers is that — so a
 * promotion starts from an exact email, which is what an admin has when someone asks for
 * access.
 */
export async function listStaff(tx: Db): Promise<StaffMember[]> {
  const rows = await tx.user.findMany({
    where: { role: { in: ["staff", "admin"] } },
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      totpEnabledAt: true,
      disabledAt: true,
      createdAt: true,
    },
  });

  return rows.map(toMember);
}

/** Exact-match lookup for the promote box. Never a prefix scan — this is not a people search. */
export async function findByEmail(tx: Db, email: string): Promise<StaffMember | null> {
  const row = await tx.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      totpEnabledAt: true,
      disabledAt: true,
      createdAt: true,
    },
  });

  return row ? toMember(row) : null;
}

function toMember(row: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  totpEnabledAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
}): StaffMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    twoFactorEnabled: row.totpEnabledAt !== null,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}

export type ChangeRoleResult =
  | { kind: "ok"; member: StaffMember }
  | { kind: "not_found" }
  | { kind: "unchanged" }
  | { kind: "self" }
  | { kind: "last_admin" };

/**
 * Moves an account between customer, staff and admin.
 *
 * Three refusals, and each is a way to lose the store rather than a matter of taste:
 *
 * **Not yourself.** An admin who demotes their own account loses the page they would use to
 * undo it. Harmless-looking, unrecoverable without database access.
 *
 * **Not the last admin.** Two admins demoting each other in either order leaves nobody who can
 * reach settings, staff, or the audit log. Counted inside the transaction with the row locked,
 * because the check and the write are otherwise a race — two concurrent demotions each see two
 * admins and both succeed.
 *
 * **Sessions are stamped.** The role rides in a JWT that cannot be deleted server-side, so a
 * demoted staff member would keep staff access until their token happened to refresh.
 * `sessionsRevokedAt` is the existing answer to exactly this (docs/07), and the route guards
 * already check it, so a demotion takes effect on their very next request.
 */
export async function changeRole(
  tx: Db,
  userId: string,
  role: Role,
  actor: { id: string; ip?: string | null; userAgent?: string | null }
): Promise<ChangeRoleResult> {
  if (userId === actor.id) return { kind: "self" };

  const before = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!before) return { kind: "not_found" };
  if (before.role === role) return { kind: "unchanged" };

  if (before.role === "admin") {
    /**
     * `FOR UPDATE`, not a plain count. Under REPEATABLE READ a plain read answers from the
     * snapshot taken at the transaction's first statement, so two concurrent demotions would
     * each still see the other admin and both commit — the same stale-snapshot mechanism that
     * oversold stock in P5-04.
     */
    const admins = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM users WHERE role = 'admin' FOR UPDATE`;
    if (Number(admins[0]?.n ?? 0) <= 1) return { kind: "last_admin" };
  }

  const after = await tx.user.update({
    where: { id: userId },
    // Only the role and the revocation stamp. Never a password, never the 2FA secret.
    data: { role, sessionsRevokedAt: new Date() },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      totpEnabledAt: true,
      disabledAt: true,
      createdAt: true,
    },
  });

  await log(tx, {
    actorId: actor.id,
    action: "user.role_change",
    entity: "user",
    entityId: userId,
    before: { email: before.email, role: before.role },
    after: { email: after.email, role: after.role },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok", member: toMember(after) };
}

export const staffService = {
  list: () => listStaff(db),
  findByEmail: (email: string) => findByEmail(db, email),
  // One transaction: the last-admin count, the update and the audit row must stand or fall
  // together, or the log describes a demotion that rolled back.
  changeRole: (userId: string, role: Role, actor: Parameters<typeof changeRole>[3]) =>
    db.$transaction((tx) => changeRole(tx, userId, role, actor)),
};
