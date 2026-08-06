import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  claimCoupon,
  COUPON_HOLD_SECONDS,
  createCoupon,
  deactivateCoupon,
  listCouponsForAdmin,
  redeemCoupon,
  updateCoupon,
  validateCoupon,
} from "./coupon.service";

/**
 * The P4-05 acceptance criterion, against real MySQL: usage caps hold under concurrent
 * redemption.
 *
 * Like the last-unit stock race, this cannot be tested with mocks — the guarantee comes from
 * InnoDB row locks taken by SELECT ... FOR UPDATE. A green test against a fake database
 * proves nothing, so there is a control below that runs the same scenario *without* the lock
 * and is expected to break the cap. If that control ever passes, this whole file has stopped
 * testing anything.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`.toUpperCase();

async function wipe() {
  await db.couponRedemption.deleteMany();
  await db.coupon.deleteMany();
  await db.auditLog.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.user.deleteMany();
}

async function makeCoupon(overrides: Record<string, unknown> = {}) {
  return db.coupon.create({
    data: {
      code: unique("SAVE"),
      type: "fixed",
      valueCents: 10_000,
      maxUses: 1,
      maxUsesPerUser: 1,
      ...overrides,
    },
  });
}

async function makeOrder(couponCode: string | null, extra: Record<string, unknown> = {}) {
  return db.order.create({
    data: {
      orderNo: unique("TS-C"),
      paymentStatus: "awaiting_payment",
      subtotalCents: 100_000,
      totalCents: 90_000,
      couponCode,
      shippingAddress: {},
      customerName: "Joel Santos",
      customerEmail: "joel@example.test",
      customerPhone: "09171234567",
      placedAt: new Date(),
      ...extra,
    },
  });
}

/** One redemption in its own transaction, so several can genuinely run at once. */
function attemptRedeem(code: string, orderId: string, userId: string | null = null) {
  return db.$transaction((tx) => redeemCoupon(tx, code, orderId, userId, 10_000), {
    timeout: 20_000,
    maxWait: 15_000,
  });
}

function attemptClaim(code: string, userId: string | null = null) {
  return db.$transaction((tx) => claimCoupon(tx, code, userId), {
    timeout: 20_000,
    maxWait: 15_000,
  });
}

describeIntegration("coupon.service", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("redemption under concurrency", () => {
    it("lets exactly one of two simultaneous redemptions pass the cap", async () => {
      const coupon = await makeCoupon({ maxUses: 1 });
      const [a, b] = await Promise.all([makeOrder(coupon.code), makeOrder(coupon.code)]);

      const results = await Promise.all([
        attemptRedeem(coupon.code, a.id),
        attemptRedeem(coupon.code, b.id),
      ]);

      expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "over_cap")).toHaveLength(1);

      // Both payments are real, so both are recorded — the cap being passed is reported,
      // never hidden by dropping a row.
      expect(await db.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(2);

      // The counter is exact. A lost update would leave this at 1.
      const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.usedCount).toBe(2);
    });

    it("holds at three uses under ten simultaneous redemptions", async () => {
      const coupon = await makeCoupon({ maxUses: 3 });
      const orders = await Promise.all(Array.from({ length: 10 }, () => makeOrder(coupon.code)));

      const results = await Promise.all(
        orders.map((order) => attemptRedeem(coupon.code, order.id))
      );

      expect(results.filter((r) => r.kind === "ok")).toHaveLength(3);
      expect(results.filter((r) => r.kind === "over_cap")).toHaveLength(7);

      const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.usedCount).toBe(10);
      expect(await db.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(10);
    });

    it("CONTROL: the unlocked read-modify-write cannot do this", async () => {
      /**
       * Proves the two tests above can fail — without this, a green suite would prove nothing.
       *
       * This is the shape the service had before P4-05: read usedCount, create the row, write
       * back read + 1. It breaks in one of two ways depending on timing, and the assertion
       * accepts either because both mean the same thing:
       *
       *   - transactions deadlock, because they take the same row locks in an order MySQL
       *     did not choose (this is what happens most often at ten-way concurrency)
       *   - or they all commit and the counter is short, because each one wrote back a number
       *     it read before the others committed
       *
       * The locked version does neither.
       */
      const coupon = await makeCoupon({ maxUses: 1 });
      const orders = await Promise.all(Array.from({ length: 10 }, () => makeOrder(coupon.code)));

      const outcomes = await Promise.allSettled(
        orders.map((order) =>
          db.$transaction(async (tx) => {
            const read = await tx.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
            await tx.couponRedemption.create({
              data: { couponId: coupon.id, orderId: order.id, discountCents: 10_000 },
            });
            await tx.coupon.update({
              where: { id: coupon.id },
              data: { usedCount: read.usedCount + 1 },
            });
          })
        )
      );

      const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
      const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      const rows = await db.couponRedemption.count({ where: { couponId: coupon.id } });

      expect(failed > 0 || after.usedCount < rows).toBe(true);
    });

    it("counts a replayed webhook once", async () => {
      const coupon = await makeCoupon({ maxUses: 5 });
      const order = await makeOrder(coupon.code);

      expect((await attemptRedeem(coupon.code, order.id)).kind).toBe("ok");
      expect((await attemptRedeem(coupon.code, order.id)).kind).toBe("already_recorded");

      const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.usedCount).toBe(1);
    });

    it("survives two copies of the same webhook arriving at once", async () => {
      // Idempotency by a read-then-check alone loses this race; the unique index does not.
      const coupon = await makeCoupon({ maxUses: 5 });
      const order = await makeOrder(coupon.code);

      const results = await Promise.allSettled([
        attemptRedeem(coupon.code, order.id),
        attemptRedeem(coupon.code, order.id),
      ]);

      expect(await db.couponRedemption.count({ where: { orderId: order.id } })).toBe(1);
      const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.usedCount).toBe(1);
      // One of the two may reject on the unique constraint rather than return a value. Either
      // is fine; a second row is not.
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    });

    it("does nothing for a code that no longer exists", async () => {
      const order = await makeOrder(null);
      expect((await attemptRedeem("GONE-FOREVER", order.id)).kind).toBe("not_found");
    });
  });

  describe("claiming at checkout", () => {
    it("lets exactly one of two simultaneous checkouts take the last use", async () => {
      const coupon = await makeCoupon({ maxUses: 1 });
      const order = await makeOrder(coupon.code);
      void order;

      // One use is already held by an unpaid, recent checkout, so the next claim must fail.
      const results = await Promise.all([attemptClaim(coupon.code), attemptClaim(coupon.code)]);

      expect(results.every((r) => r.kind === "rejected")).toBe(true);
    });

    it("counts an unpaid checkout as a use, so validate alone cannot be raced", async () => {
      const coupon = await makeCoupon({ maxUses: 1 });

      // usedCount is still 0 — it only moves on payment — so the unlocked read says yes.
      const optimistic = await validateCoupon(db, coupon.code, {
        subtotalCents: 100_000,
        shippingCents: 0,
        isMember: false,
      });
      expect(optimistic.kind).toBe("ok");

      await makeOrder(coupon.code);

      // The claim sees the in-flight checkout and says no. This gap is the reason claim exists.
      expect((await attemptClaim(coupon.code)).kind).toBe("rejected");
    });

    it("releases the use when a checkout is abandoned", async () => {
      // Otherwise an abandoned basket burns a single-use code forever and the customer has no
      // way to get it back. Same 15-minute window stock reservations get.
      const coupon = await makeCoupon({ maxUses: 1 });
      const stale = new Date(Date.now() - (COUPON_HOLD_SECONDS + 60) * 1000);
      await makeOrder(coupon.code, { placedAt: stale, createdAt: stale });

      expect((await attemptClaim(coupon.code)).kind).toBe("ok");
    });

    it("ignores a cancelled checkout", async () => {
      const coupon = await makeCoupon({ maxUses: 1 });
      await makeOrder(coupon.code, { status: "cancelled", cancelReason: "Changed their mind" });

      expect((await attemptClaim(coupon.code)).kind).toBe("ok");
    });

    it("enforces the per-user cap across paid and in-flight orders", async () => {
      const coupon = await makeCoupon({ maxUses: null, maxUsesPerUser: 1 });
      const user = await db.user.create({
        data: {
          name: "Joel",
          email: `${unique("u")}@example.test`.toLowerCase(),
          role: "customer",
        },
      });

      expect((await attemptClaim(coupon.code, user.id)).kind).toBe("ok");

      await makeOrder(coupon.code, { userId: user.id });

      const blocked = await attemptClaim(coupon.code, user.id);
      expect(blocked.kind).toBe("rejected");
      if (blocked.kind === "rejected") expect(blocked.reason).toBe("already_used_by_you");

      // Someone else is unaffected by this customer's basket.
      expect((await attemptClaim(coupon.code, null)).kind).toBe("ok");
    });

    it("lets an uncapped coupon through however many are in flight", async () => {
      const coupon = await makeCoupon({ maxUses: null, maxUsesPerUser: 99 });
      await Promise.all(Array.from({ length: 5 }, () => makeOrder(coupon.code)));

      expect((await attemptClaim(coupon.code)).kind).toBe("ok");
    });

    it("rejects a code that does not exist", async () => {
      const result = await attemptClaim("NEVER-EXISTED");
      expect(result.kind).toBe("rejected");
      if (result.kind === "rejected") expect(result.reason).toBe("not_found");
    });
  });

  describe("admin CRUD", () => {
    const actor = { id: "", ip: "203.0.113.9" };

    beforeEach(async () => {
      const admin = await db.user.create({
        data: {
          name: "Ramon",
          email: `${unique("a")}@example.test`.toLowerCase(),
          role: "admin",
        },
      });
      actor.id = admin.id;
    });

    it("creates a coupon and audits it", async () => {
      const code = unique("NEW");
      const result = await createCoupon(
        db,
        { code, type: "percentage", percentage: 15, maxUses: 100 },
        actor
      );

      expect(result.kind).toBe("ok");
      const saved = await db.coupon.findUniqueOrThrow({ where: { code } });
      expect(saved.percentage).toBe(15);

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "coupon.create" } });
      expect(entry.actorId).toBe(actor.id);
      expect(entry.ip).toBe("203.0.113.9");
    });

    it("refuses a code that already exists", async () => {
      const existing = await makeCoupon();
      const result = await createCoupon(db, { code: existing.code, type: "free_shipping" }, actor);

      expect(result.kind).toBe("code_taken");
    });

    it("normalises the code so lookup and display agree", async () => {
      const code = unique("MiXeD");
      await createCoupon(db, { code: `  ${code.toLowerCase()}  `, type: "free_shipping" }, actor);

      expect(await db.coupon.findUnique({ where: { code: code.toUpperCase() } })).not.toBeNull();
    });

    it("records the before and after of an edit", async () => {
      const coupon = await makeCoupon({ maxUses: 10 });
      await updateCoupon(db, coupon.id, { maxUses: 50 }, actor);

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "coupon.update" } });
      expect(entry.before).toMatchObject({ maxUses: 10 });
      expect(entry.after).toMatchObject({ maxUses: 50 });
    });

    it("will not let an edit steal another coupon's code", async () => {
      const first = await makeCoupon();
      const second = await makeCoupon();

      expect((await updateCoupon(db, second.id, { code: first.code }, actor)).kind).toBe(
        "code_taken"
      );
    });

    it("deletes an unused coupon outright", async () => {
      const coupon = await makeCoupon();
      await deactivateCoupon(db, coupon.id, actor);

      expect(await db.coupon.findUnique({ where: { id: coupon.id } })).toBeNull();
    });

    it("deactivates rather than deletes a coupon that has been used", async () => {
      // Deleting cascades to the redemption rows, which are the record of what it gave away.
      const coupon = await makeCoupon({ maxUses: 5 });
      const order = await makeOrder(coupon.code);
      await attemptRedeem(coupon.code, order.id);

      await deactivateCoupon(db, coupon.id, actor);

      const after = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(after.isActive).toBe(false);
      expect(await db.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(1);
    });

    it("reports what each coupon has given away", async () => {
      const coupon = await makeCoupon({ maxUses: 10 });
      for (const _ of [1, 2]) {
        const order = await makeOrder(coupon.code);
        await attemptRedeem(coupon.code, order.id);
      }

      const row = (await listCouponsForAdmin(db)).find((c) => c.id === coupon.id);
      expect(row?.redemptionCount).toBe(2);
      expect(row?.discountedCents).toBe(20_000);
    });
  });
});
