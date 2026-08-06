import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { auditFacets, listAuditLog, log } from "./audit.service";

/**
 * The P4-06 acceptance criterion: the audit log is filterable by actor, entity and date.
 *
 * The date half is the one worth testing hard. Timestamps are UTC and the admin thinks in
 * Manila days, so a filter that compares the typed date against the raw column silently drops
 * the first eight hours of every day — and nobody notices, because the missing rows look like
 * a quiet morning.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

let ramon = "";
let grace = "";

async function wipe() {
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
}

async function entry(
  actorId: string,
  overrides: { entity?: string; action?: string; entityId?: string; createdAt?: Date } = {}
) {
  await log(db, {
    actorId,
    action: (overrides.action ?? "product.update") as never,
    entity: overrides.entity ?? "Product",
    entityId: overrides.entityId ?? unique("ent"),
  });

  if (overrides.createdAt) {
    // log() stamps now(); backdating afterwards keeps the write path under test.
    const latest = await db.auditLog.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    await db.auditLog.update({
      where: { id: latest.id },
      data: { createdAt: overrides.createdAt },
    });
  }
}

describeIntegration("audit log", () => {
  beforeEach(async () => {
    await wipe();
    const [a, b] = await Promise.all([
      db.user.create({
        data: { name: "Ramon", email: `${unique("r")}@example.test`, role: "admin" },
      }),
      db.user.create({
        data: { name: "Grace", email: `${unique("g")}@example.test`, role: "staff" },
      }),
    ]);
    ramon = a.id;
    grace = b.id;
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("returns everything, newest first, when nothing is filtered", async () => {
    await entry(ramon, { createdAt: new Date("2026-08-01T04:00:00Z") });
    await entry(grace, { createdAt: new Date("2026-08-05T04:00:00Z") });

    const { rows } = await listAuditLog(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.actorId).toBe(grace);
  });

  it("filters by actor", async () => {
    await entry(ramon);
    await entry(ramon);
    await entry(grace);

    const { rows } = await listAuditLog(db, { actorId: ramon });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.actorId === ramon)).toBe(true);
  });

  it("filters by entity", async () => {
    await entry(ramon, { entity: "Product" });
    await entry(ramon, { entity: "Order", action: "order.transition" });
    await entry(ramon, { entity: "Order", action: "order.transition" });

    const { rows } = await listAuditLog(db, { entity: "Order" });
    expect(rows).toHaveLength(2);
  });

  it("filters by action, which is narrower than entity", async () => {
    await entry(ramon, { entity: "Coupon", action: "coupon.create" });
    await entry(ramon, { entity: "Coupon", action: "coupon.update" });

    const { rows } = await listAuditLog(db, { action: "coupon.create" });
    expect(rows).toHaveLength(1);
  });

  describe("filtering by date", () => {
    it("includes both ends of the range", async () => {
      await entry(ramon, { createdAt: new Date("2026-08-03T04:00:00Z") });
      await entry(ramon, { createdAt: new Date("2026-08-05T04:00:00Z") });
      await entry(ramon, { createdAt: new Date("2026-08-07T04:00:00Z") });

      const { rows } = await listAuditLog(db, { from: "2026-08-03", to: "2026-08-07" });
      expect(rows).toHaveLength(3);
    });

    it("keeps an early-morning Manila entry inside its own day", async () => {
      // 07:00 Manila on the 7th is 23:00 UTC on the 6th. Compared against a UTC day this row
      // falls on the 6th and disappears from a search for the 7th.
      await entry(ramon, { createdAt: new Date("2026-08-06T23:00:00Z") });

      expect((await listAuditLog(db, { from: "2026-08-07", to: "2026-08-07" })).rows).toHaveLength(
        1
      );
      expect((await listAuditLog(db, { from: "2026-08-06", to: "2026-08-06" })).rows).toHaveLength(
        0
      );
    });

    it("keeps a late-evening Manila entry inside its own day", async () => {
      // 23:30 Manila on the 7th is 15:30 UTC on the 7th — still the 7th either way, but the
      // upper boundary has to reach it.
      await entry(ramon, { createdAt: new Date("2026-08-07T15:30:00Z") });

      expect((await listAuditLog(db, { to: "2026-08-07" })).rows).toHaveLength(1);
    });

    it("accepts an open-ended range", async () => {
      await entry(ramon, { createdAt: new Date("2026-08-01T04:00:00Z") });
      await entry(ramon, { createdAt: new Date("2026-08-09T04:00:00Z") });

      expect((await listAuditLog(db, { from: "2026-08-05" })).rows).toHaveLength(1);
      expect((await listAuditLog(db, { to: "2026-08-05" })).rows).toHaveLength(1);
    });

    it("ignores a date it cannot parse rather than returning nothing", async () => {
      // A malformed filter that silently matched zero rows would read as "nothing happened".
      await entry(ramon);
      expect((await listAuditLog(db, { from: "last tuesday" })).rows).toHaveLength(1);
    });
  });

  it("combines actor, entity and date", async () => {
    await entry(ramon, { entity: "Order", createdAt: new Date("2026-08-05T04:00:00Z") });
    await entry(ramon, { entity: "Product", createdAt: new Date("2026-08-05T04:00:00Z") });
    await entry(grace, { entity: "Order", createdAt: new Date("2026-08-05T04:00:00Z") });
    await entry(ramon, { entity: "Order", createdAt: new Date("2026-07-01T04:00:00Z") });

    const { rows } = await listAuditLog(db, {
      actorId: ramon,
      entity: "Order",
      from: "2026-08-01",
      to: "2026-08-31",
    });

    expect(rows).toHaveLength(1);
  });

  it("finds an entity's whole history from its id", async () => {
    const productId = unique("prod");
    await entry(ramon, { entityId: productId, action: "product.create" });
    await entry(grace, { entityId: productId, action: "product.update" });
    await entry(ramon, { entityId: unique("other") });

    expect((await listAuditLog(db, { q: productId })).rows).toHaveLength(2);
  });

  it("pages with a cursor and stops when there is no more", async () => {
    for (let i = 0; i < 5; i += 1) {
      await entry(ramon, { createdAt: new Date(Date.UTC(2026, 7, i + 1)) });
    }

    const first = await listAuditLog(db, { limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAuditLog(db, { limit: 2, cursor: first.nextCursor });
    expect(second.rows).toHaveLength(2);
    // No overlap between pages.
    expect(second.rows.map((r) => r.id)).not.toContain(first.rows[0]?.id);

    const third = await listAuditLog(db, { limit: 2, cursor: second.nextCursor });
    expect(third.rows).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
  });

  it("names the actor rather than making the reader look up an id", async () => {
    await entry(ramon);
    expect((await listAuditLog(db)).rows[0]?.actor?.name).toBe("Ramon");
  });

  it("offers the entities and actions actually present as filters", async () => {
    await entry(ramon, { entity: "Coupon", action: "coupon.create" });
    await entry(grace, { entity: "Order", action: "order.transition" });

    const facets = await auditFacets(db);
    expect(facets.entities).toEqual(["Coupon", "Order"]);
    expect(facets.actions).toEqual(["coupon.create", "order.transition"]);
    expect(facets.actors.map((actor) => actor.name).sort()).toEqual(["Grace", "Ramon"]);
  });

  it("never writes a password hash into the log", async () => {
    // The log is the table most likely to be exported into a spreadsheet.
    await log(db, {
      actorId: ramon,
      action: "user.role_change",
      entity: "User",
      entityId: grace,
      before: { role: "staff", passwordHash: "$argon2id$v=19$leaked" },
      after: { role: "admin" },
    });

    const row = await db.auditLog.findFirstOrThrow({ where: { entity: "User" } });
    expect(JSON.stringify(row.before)).not.toContain("argon2");
    expect(row.before).toMatchObject({ role: "staff" });
  });
});
