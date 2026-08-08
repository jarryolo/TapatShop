import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { changeRole, findByEmail, listStaff } from "./staff.service";

/**
 * P1-07: staff management.
 *
 * The properties worth proving are the ones that would lose the store rather than merely
 * annoy someone — an admin locking every admin out, a demotion that leaves the demoted person
 * still signed in with their old role, or a role change that touches a password.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
}

async function makeUser(role: "customer" | "staff" | "admin", extra: { name?: string } = {}) {
  return db.user.create({
    data: {
      name: extra.name ?? "Ramon",
      email: `${unique("u")}@example.test`,
      role: role as never,
      passwordHash: "argon2-placeholder",
    },
  });
}

const actorFrom = (id: string) => ({ id, ip: "203.0.113.9", userAgent: "vitest" });

describeIntegration("staff service", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("listing", () => {
    it("lists staff and admins and leaves customers out", async () => {
      const admin = await makeUser("admin");
      const staff = await makeUser("staff");
      await makeUser("customer");

      const listed = await listStaff(db);
      expect(listed.map((m) => m.id).sort()).toEqual([admin.id, staff.id].sort());
    });

    it("finds a customer by exact email so they can be promoted", async () => {
      const customer = await makeUser("customer");

      expect((await findByEmail(db, customer.email))?.id).toBe(customer.id);
      // Case and stray whitespace come from a pasted address, not from a different person.
      expect((await findByEmail(db, ` ${customer.email.toUpperCase()} `))?.id).toBe(customer.id);
      expect(await findByEmail(db, "nobody@example.test")).toBeNull();
    });

    it("reports whether two-factor is set up", async () => {
      const staff = await makeUser("staff");
      await db.user.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });

      const listed = await listStaff(db);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.twoFactorEnabled).toBe(true);
    });
  });

  describe("changing a role", () => {
    it("promotes a customer to staff and writes an audit row", async () => {
      const admin = await makeUser("admin");
      const customer = await makeUser("customer");

      const result = await changeRole(db, customer.id, "staff", actorFrom(admin.id));
      expect(result.kind).toBe("ok");

      expect((await db.user.findUnique({ where: { id: customer.id } }))?.role).toBe("staff");

      const entry = await db.auditLog.findFirst({ where: { entityId: customer.id } });
      expect(entry?.action).toBe("user.role_change");
      expect(entry?.actorId).toBe(admin.id);
      expect(entry?.before).toMatchObject({ role: "customer" });
      expect(entry?.after).toMatchObject({ role: "staff" });
    });

    it("revokes existing sessions, so a demotion takes effect immediately", async () => {
      /**
       * The role rides in a JWT that cannot be deleted server-side. Without this stamp a
       * demoted staff member keeps staff access until their token happens to refresh — which
       * is the whole window an admin thinks they have just closed.
       */
      const admin = await makeUser("admin");
      const staff = await makeUser("staff");
      expect((await db.user.findUnique({ where: { id: staff.id } }))?.sessionsRevokedAt).toBeNull();

      await changeRole(db, staff.id, "customer", actorFrom(admin.id));

      const after = await db.user.findUnique({ where: { id: staff.id } });
      expect(after?.sessionsRevokedAt).not.toBeNull();
    });

    it("never touches the password or the 2FA secret", async () => {
      // CLAUDE.md: an admin can neither read nor set a password. A role change is the most
      // likely place for that to quietly stop being true.
      const admin = await makeUser("admin");
      const staff = await makeUser("staff");
      await db.user.update({
        where: { id: staff.id },
        data: { totpSecret: "JBSWY3DPEHPK3PXP", totpEnabledAt: new Date() },
      });

      await changeRole(db, staff.id, "admin", actorFrom(admin.id));

      const after = await db.user.findUnique({ where: { id: staff.id } });
      expect(after?.passwordHash).toBe("argon2-placeholder");
      expect(after?.totpSecret).toBe("JBSWY3DPEHPK3PXP");
    });

    it("keeps the secret out of the audit log", async () => {
      const admin = await makeUser("admin");
      const staff = await makeUser("staff");

      await changeRole(db, staff.id, "admin", actorFrom(admin.id));

      const entry = await db.auditLog.findFirst({ where: { entityId: staff.id } });
      expect(JSON.stringify(entry)).not.toContain("argon2-placeholder");
    });

    it("refuses to change your own role", async () => {
      // An admin who demotes themselves loses the page they would use to undo it.
      const admin = await makeUser("admin");

      expect((await changeRole(db, admin.id, "staff", actorFrom(admin.id))).kind).toBe("self");
      expect((await db.user.findUnique({ where: { id: admin.id } }))?.role).toBe("admin");
    });

    it("refuses to demote the last admin", async () => {
      const admin = await makeUser("admin");
      const other = await makeUser("admin");

      // Two admins: demoting one is fine.
      expect((await changeRole(db, other.id, "staff", actorFrom(admin.id))).kind).toBe("ok");

      // One left: an admin cannot be demoted by anyone, including a second admin's session.
      const staff = await makeUser("staff");
      expect((await changeRole(db, admin.id, "customer", actorFrom(staff.id))).kind).toBe(
        "last_admin"
      );
      expect((await db.user.findUnique({ where: { id: admin.id } }))?.role).toBe("admin");
    });

    it("leaves at least one admin when two demotions race", async () => {
      /**
       * The check and the write are a race unless the count locks. Both transactions would
       * otherwise read "two admins" from their own snapshot and both commit, and the store
       * ends up with nobody who can reach settings, staff, or the audit log.
       */
      const a = await makeUser("admin");
      const b = await makeUser("admin");
      const mover = await makeUser("staff");

      const results = await Promise.allSettled([
        db.$transaction((tx) => changeRole(tx, a.id, "customer", actorFrom(mover.id))),
        db.$transaction((tx) => changeRole(tx, b.id, "customer", actorFrom(mover.id))),
      ]);

      const admins = await db.user.count({ where: { role: "admin" } });
      expect(admins).toBeGreaterThanOrEqual(1);

      const succeeded = results.filter(
        (r) => r.status === "fulfilled" && r.value.kind === "ok"
      ).length;
      expect(succeeded).toBe(1);
    });

    it("is a no-op when the role is already what was asked for", async () => {
      const admin = await makeUser("admin");
      const staff = await makeUser("staff");

      expect((await changeRole(db, staff.id, "staff", actorFrom(admin.id))).kind).toBe("unchanged");
      // No audit row, because nothing changed — a log full of non-events is a log nobody reads.
      expect(await db.auditLog.count()).toBe(0);
    });

    it("reports a missing account rather than throwing", async () => {
      const admin = await makeUser("admin");
      expect((await changeRole(db, "does-not-exist", "staff", actorFrom(admin.id))).kind).toBe(
        "not_found"
      );
    });
  });
});
