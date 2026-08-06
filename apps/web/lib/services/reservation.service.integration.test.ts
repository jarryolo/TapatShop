import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { redis } from "@/lib/redis";

import {
  RESERVATION_TTL_SECONDS,
  attachToOrder,
  availableStock,
  mirrorToRedis,
  releaseForOrder,
  releaseReservations,
  reservationExpiry,
  reservationKey,
  reserve,
  sweepExpiredReservations,
} from "./reservation.service";

/**
 * The P3-03 acceptance criteria, against real MySQL — and the one that matters most:
 * two simultaneous checkouts for the last unit must resolve to exactly one winner.
 *
 * This cannot be tested with mocks. The guarantee comes from InnoDB row locks taken by
 * SELECT ... FOR UPDATE, so anything that fakes the database proves nothing.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.stockReservation.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.inventoryMovement.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
}

async function makeVariant(stock: number) {
  const product = await db.product.create({
    data: {
      name: unique("Product"),
      slug: unique("product"),
      status: "active",
      variants: {
        create: {
          sku: unique("SKU").toUpperCase(),
          name: "Default",
          priceCents: 100_000,
          stockQty: stock,
        },
      },
    },
    include: { variants: true },
  });

  const variant = product.variants[0];
  if (!variant) throw new Error("setup failed");
  return variant;
}

/** One checkout's reservation attempt, in its own transaction. */
function attemptReservation(cartId: string, variantId: string, quantity: number) {
  return db.$transaction((tx) => reserve(tx, cartId, [{ variantId, quantity }]), {
    timeout: 20_000,
    maxWait: 15_000,
  });
}

describeIntegration("reservation.service", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("availability", () => {
    it("is on-hand minus what is held", async () => {
      const variant = await makeVariant(10);
      expect(await availableStock(db, variant.id)).toBe(10);

      await attemptReservation("cart-a", variant.id, 3);
      expect(await availableStock(db, variant.id)).toBe(7);
    });

    it("does not decrement stockQty — reserving is not selling", async () => {
      // Stock leaves only on the paid webhook, through the ledger. docs/03.
      const variant = await makeVariant(5);
      await attemptReservation("cart-a", variant.id, 5);

      const after = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(after.stockQty).toBe(5);
      expect(await availableStock(db, variant.id)).toBe(0);
    });

    it("ignores expired reservations without needing the sweeper", async () => {
      const variant = await makeVariant(5);
      await db.stockReservation.create({
        data: {
          variantId: variant.id,
          quantity: 5,
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      // This is why a sweeper outage cannot make stock unsellable.
      expect(await availableStock(db, variant.id)).toBe(5);
    });

    it("ignores released reservations", async () => {
      const variant = await makeVariant(4);
      const result = await attemptReservation("cart-a", variant.id, 4);
      if (result.kind !== "ok") throw new Error("setup failed");

      await releaseReservations(db, result.reservationIds);
      expect(await availableStock(db, variant.id)).toBe(4);
    });

    it("never reports negative availability", async () => {
      const variant = await makeVariant(2);
      await db.stockReservation.create({
        data: { variantId: variant.id, quantity: 5, expiresAt: reservationExpiry() },
      });

      expect(await availableStock(db, variant.id)).toBe(0);
    });
  });

  describe("the last unit", () => {
    it("lets exactly one of two simultaneous checkouts win", async () => {
      // THE test. docs/03: "the most likely production bug in this system".
      const variant = await makeVariant(1);

      const [first, second] = await Promise.all([
        attemptReservation("cart-a", variant.id, 1),
        attemptReservation("cart-b", variant.id, 1),
      ]);

      const winners = [first, second].filter((result) => result.kind === "ok");
      const losers = [first, second].filter((result) => result.kind === "insufficient");

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);

      // And the loser is told what is actually available, not just that it failed.
      const loser = losers[0];
      if (loser?.kind === "insufficient") {
        expect(loser.shortfalls[0]).toMatchObject({ requested: 1, available: 0 });
      }

      expect(await db.stockReservation.count({ where: { variantId: variant.id } })).toBe(1);
      expect(await availableStock(db, variant.id)).toBe(0);
    });

    it("holds under ten simultaneous attempts on three units", async () => {
      const variant = await makeVariant(3);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => attemptReservation(`cart-${i}`, variant.id, 1))
      );

      const won = results.filter((result) => result.kind === "ok");
      expect(won).toHaveLength(3);
      expect(await availableStock(db, variant.id)).toBe(0);

      // Nothing oversold: the sum of what is held never exceeds what exists.
      const held = await db.stockReservation.aggregate({
        where: { variantId: variant.id, releasedAt: null },
        _sum: { quantity: true },
      });
      expect(held._sum.quantity).toBe(3);
    });

    it("refuses a basket asking for more than is left", async () => {
      const variant = await makeVariant(2);
      const result = await attemptReservation("cart-a", variant.id, 3);

      expect(result.kind).toBe("insufficient");
      expect(await db.stockReservation.count()).toBe(0);
    });
  });

  describe("all or nothing", () => {
    it("reserves nothing when any line cannot be satisfied", async () => {
      // A half-reserved basket holds stock for items the customer was never told they could
      // not complete.
      const plenty = await makeVariant(10);
      const scarce = await makeVariant(1);

      const result = await db.$transaction(
        (tx) =>
          reserve(tx, "cart-a", [
            { variantId: plenty.id, quantity: 2 },
            { variantId: scarce.id, quantity: 5 },
          ]),
        { timeout: 20_000 }
      );

      expect(result.kind).toBe("insufficient");
      expect(await db.stockReservation.count()).toBe(0);
      expect(await availableStock(db, plenty.id)).toBe(10);
    });

    it("reserves every line when all of them fit", async () => {
      const a = await makeVariant(5);
      const b = await makeVariant(5);

      const result = await db.$transaction(
        (tx) =>
          reserve(tx, "cart-a", [
            { variantId: a.id, quantity: 2 },
            { variantId: b.id, quantity: 3 },
          ]),
        { timeout: 20_000 }
      );

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.reservationIds).toHaveLength(2);
      expect(await availableStock(db, a.id)).toBe(3);
      expect(await availableStock(db, b.id)).toBe(2);
    });

    it("does not deadlock when two baskets hold the same pair in opposite order", async () => {
      // Locking in id order is what prevents this. Without it, this test hangs until one
      // transaction is killed as a deadlock victim.
      const a = await makeVariant(10);
      const b = await makeVariant(10);

      const [first, second] = await Promise.all([
        db.$transaction(
          (tx) =>
            reserve(tx, "cart-a", [
              { variantId: a.id, quantity: 1 },
              { variantId: b.id, quantity: 1 },
            ]),
          { timeout: 20_000, maxWait: 15_000 }
        ),
        db.$transaction(
          (tx) =>
            reserve(tx, "cart-b", [
              { variantId: b.id, quantity: 1 },
              { variantId: a.id, quantity: 1 },
            ]),
          { timeout: 20_000, maxWait: 15_000 }
        ),
      ]);

      expect(first.kind).toBe("ok");
      expect(second.kind).toBe("ok");
    });
  });

  describe("expiry and the sweeper", () => {
    it("expires 15 minutes out", async () => {
      const now = new Date("2026-08-06T00:00:00.000Z");
      const expiry = reservationExpiry(now);

      expect((expiry.getTime() - now.getTime()) / 1000).toBe(RESERVATION_TTL_SECONDS);
      expect(RESERVATION_TTL_SECONDS).toBe(900);
    });

    it("returns stock once a reservation expires", async () => {
      const variant = await makeVariant(1);
      const result = await attemptReservation("cart-a", variant.id, 1);
      if (result.kind !== "ok") throw new Error("setup failed");

      expect(await availableStock(db, variant.id)).toBe(0);

      // Wind the clock forward by moving the expiry into the past.
      await db.stockReservation.updateMany({
        where: { id: { in: result.reservationIds } },
        data: { expiresAt: new Date(Date.now() - 1) },
      });

      expect(await availableStock(db, variant.id)).toBe(1);

      // And the next buyer can take it.
      expect((await attemptReservation("cart-b", variant.id, 1)).kind).toBe("ok");
    });

    it("releases the rows Redis lost", async () => {
      const variant = await makeVariant(5);
      await db.stockReservation.createMany({
        data: [
          { variantId: variant.id, quantity: 1, expiresAt: new Date(Date.now() - 10_000) },
          { variantId: variant.id, quantity: 1, expiresAt: new Date(Date.now() - 5_000) },
          { variantId: variant.id, quantity: 1, expiresAt: reservationExpiry() },
        ],
      });

      const result = await sweepExpiredReservations(db);

      expect(result.released).toBe(2);
      // The live one is untouched.
      expect(
        await db.stockReservation.count({ where: { variantId: variant.id, releasedAt: null } })
      ).toBe(1);
    });

    it("is safe to sweep repeatedly", async () => {
      const variant = await makeVariant(5);
      await db.stockReservation.create({
        data: { variantId: variant.id, quantity: 1, expiresAt: new Date(Date.now() - 1000) },
      });

      expect((await sweepExpiredReservations(db)).released).toBe(1);
      expect((await sweepExpiredReservations(db)).released).toBe(0);
    });
  });

  describe("the Redis mirror", () => {
    /**
     * Redis is the fast expiry path, not the source of truth, so these tests skip rather
     * than fail when it is unreachable — exactly as the service itself does.
     */
    async function redisReachable(): Promise<boolean> {
      try {
        if (redis.status === "wait" || redis.status === "end") await redis.connect();
        await redis.ping();
        return true;
      } catch {
        return false;
      }
    }

    it("writes a key per line with the reservation TTL", async () => {
      if (!(await redisReachable())) return;

      const variant = await makeVariant(5);
      const cartId = unique("cart");

      await mirrorToRedis(cartId, [{ variantId: variant.id, quantity: 2 }]);

      const key = reservationKey(variant.id, cartId);
      expect(await redis.get(key)).toBe("2");

      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(RESERVATION_TTL_SECONDS);

      await redis.del(key);
    });

    it("does not fail a reservation when Redis is unreachable", async () => {
      // The durable row is what holds the stock. A Redis outage must not stop checkout.
      const variant = await makeVariant(5);

      await expect(
        mirrorToRedis(unique("cart"), [{ variantId: variant.id, quantity: 1 }], 900)
      ).resolves.toBeUndefined();
    });
  });

  describe("attaching to an order", () => {
    it("links reservations so the webhook can find them", async () => {
      const variant = await makeVariant(5);
      const result = await attemptReservation("cart-a", variant.id, 2);
      if (result.kind !== "ok") throw new Error("setup failed");

      const order = await db.order.create({
        data: {
          orderNo: unique("TS-RESV"),
          subtotalCents: 200_000,
          totalCents: 200_000,
          shippingAddress: {},
          customerName: "Joel",
          customerEmail: "joel@example.test",
          customerPhone: "09171234567",
        },
      });

      await attachToOrder(db, result.reservationIds, order.id);

      const released = await releaseForOrder(db, order.id);
      expect(released).toBe(1);
      expect(await availableStock(db, variant.id)).toBe(5);
    });

    it("releases idempotently", async () => {
      const variant = await makeVariant(5);
      const result = await attemptReservation("cart-a", variant.id, 1);
      if (result.kind !== "ok") throw new Error("setup failed");

      expect(await releaseReservations(db, result.reservationIds)).toBe(1);
      expect(await releaseReservations(db, result.reservationIds)).toBe(0);
    });
  });
});
