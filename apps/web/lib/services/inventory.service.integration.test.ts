import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  adjustStock,
  movementsFor,
  reconcileStock,
  recordSale,
  stockList,
} from "./inventory.service";

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let actorId = "";

async function wipe() {
  await db.auditLog.deleteMany();
  await db.stockReservation.deleteMany();
  await db.inventoryMovement.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

/** Creates a variant with its opening stock recorded through the ledger, as the seed does. */
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
          priceCents: 10_000,
          stockQty: 0,
        },
      },
    },
    include: { variants: true },
  });

  const variant = product.variants[0];
  if (!variant) throw new Error("setup failed");

  if (stock > 0) {
    await adjustStock(db, {
      variantId: variant.id,
      delta: stock,
      reason: "restock",
      note: "Opening stock",
      actorId,
    });
  }

  return variant;
}

describeIntegration("inventory.service", () => {
  beforeEach(async () => {
    await wipe();
    const admin = await db.user.create({
      data: { name: "Ramon", email: `${unique("a")}@example.test`, role: "admin" },
    });
    actorId = admin.id;
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("adjustments", () => {
    it("rejects an adjustment with no reason", async () => {
      // P4-03 asks for this by name. "stockQty is 3 and nobody knows why" is the failure.
      const variant = await makeVariant(5);

      const result = await adjustStock(db, {
        variantId: variant.id,
        delta: -1,
        reason: "damage",
        note: "   ",
        actorId,
      });

      expect(result.kind).toBe("no_reason");
      // And nothing moved.
      expect(
        (await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQty
      ).toBe(5);
    });

    it("rejects a zero change", async () => {
      const variant = await makeVariant(5);
      const result = await adjustStock(db, {
        variantId: variant.id,
        delta: 0,
        reason: "adjustment",
        note: "Recount",
        actorId,
      });

      expect(result.kind).toBe("zero_delta");
    });

    it("writes the movement and the cache together", async () => {
      const variant = await makeVariant(10);

      const result = await adjustStock(db, {
        variantId: variant.id,
        delta: -3,
        reason: "damage",
        note: "Water damage in transit",
        actorId,
      });

      expect(result).toMatchObject({ kind: "ok", balanceAfter: 7 });
      expect(
        (await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQty
      ).toBe(7);

      // Invariant I4 holds after every adjustment.
      const total = await db.inventoryMovement.aggregate({
        where: { variantId: variant.id },
        _sum: { delta: true },
      });
      expect(total._sum.delta).toBe(7);
    });

    it("refuses to drive physical stock negative", async () => {
      const variant = await makeVariant(2);
      const result = await adjustStock(db, {
        variantId: variant.id,
        delta: -5,
        reason: "damage",
        note: "Dropped a box",
        actorId,
      });

      expect(result).toMatchObject({ kind: "would_go_negative", stockQty: 2 });
      expect(
        await db.inventoryMovement.count({ where: { variantId: variant.id, reason: "damage" } })
      ).toBe(0);
    });

    it("audits every adjustment", async () => {
      const variant = await makeVariant(5);
      await db.auditLog.deleteMany();

      await adjustStock(db, {
        variantId: variant.id,
        delta: 4,
        reason: "restock",
        note: "Delivery from supplier",
        actorId,
        ip: "203.0.113.5",
      });

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "inventory.adjust" } });
      expect(entry.before).toMatchObject({ stockQty: 5 });
      expect(entry.after).toMatchObject({ stockQty: 9, delta: 4, reason: "restock" });
      expect(entry.ip).toBe("203.0.113.5");
    });
  });

  describe("movement history", () => {
    it("shows actor, delta, reason and a running balance", async () => {
      // The P4-03 criterion, in full.
      const variant = await makeVariant(10);
      await adjustStock(db, {
        variantId: variant.id,
        delta: -2,
        reason: "damage",
        note: "Crushed",
        actorId,
      });
      await adjustStock(db, {
        variantId: variant.id,
        delta: 5,
        reason: "restock",
        note: "Resupply",
        actorId,
      });

      const history = await movementsFor(db, variant.id);

      expect(history).toHaveLength(3);
      // Newest first: +5 → 13, -2 → 8, +10 → 10.
      expect(history.map((m) => m.balanceAfter)).toEqual([13, 8, 10]);
      expect(history.map((m) => m.delta)).toEqual([5, -2, 10]);
      expect(history[0]?.reason).toBe("restock");
      expect(history[0]?.note).toBe("Resupply");
      expect(history[0]?.actor?.name).toBe("Ramon");
    });

    it("records a sale with no actor and links the order", async () => {
      const variant = await makeVariant(5);
      const order = await db.order.create({
        data: {
          orderNo: unique("TS-INV").toUpperCase(),
          subtotalCents: 1,
          totalCents: 1,
          shippingAddress: {},
          customerName: "Joel",
          customerEmail: "joel@example.test",
          customerPhone: "09171234567",
        },
      });

      await recordSale(db, variant.id, 2, order.id);

      const history = await movementsFor(db, variant.id);
      expect(history[0]).toMatchObject({ delta: -2, reason: "sale", balanceAfter: 3 });
      // A sale is not a person.
      expect(history[0]?.actor).toBeNull();
      expect(history[0]?.order?.orderNo).toBe(order.orderNo);
    });
  });

  describe("the stock list", () => {
    it("reports on hand, reserved and available separately", async () => {
      const variant = await makeVariant(10);
      await db.stockReservation.create({
        data: {
          variantId: variant.id,
          quantity: 4,
          expiresAt: new Date(Date.now() + 900_000),
        },
      });

      const rows = await stockList(db);
      const row = rows.find((r) => r.id === variant.id);

      expect(row).toMatchObject({ stockQty: 10, reserved: 4, available: 6 });
    });

    it("ignores expired reservations when reporting availability", async () => {
      const variant = await makeVariant(10);
      await db.stockReservation.create({
        data: { variantId: variant.id, quantity: 4, expiresAt: new Date(Date.now() - 1000) },
      });

      const row = (await stockList(db)).find((r) => r.id === variant.id);
      expect(row?.available).toBe(10);
    });

    it("flags a variant at its threshold, not just below it", async () => {
      const variant = await makeVariant(5);
      await db.productVariant.update({
        where: { id: variant.id },
        data: { lowStockThreshold: 5 },
      });

      const row = (await stockList(db)).find((r) => r.id === variant.id);
      expect(row?.isLow).toBe(true);
    });

    it("filters to low stock only", async () => {
      await makeVariant(100);
      const low = await makeVariant(1);

      const rows = await stockList(db, { lowStockOnly: true });
      expect(rows.map((r) => r.id)).toContain(low.id);
      expect(rows.every((r) => r.isLow)).toBe(true);
    });
  });

  describe("reconciliation", () => {
    it("reports nothing when the ledger and the cache agree", async () => {
      await makeVariant(10);
      const result = await reconcileStock(db);

      expect(result.drift).toEqual([]);
      expect(result.checked).toBeGreaterThan(0);
    });

    it("detects drift when stockQty is written behind the ledger's back", async () => {
      const variant = await makeVariant(10);

      // Exactly what must never happen — a bare write with no movement. Simulated here so
      // the safety net can be proved to catch it.
      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 99 } });

      const result = await reconcileStock(db);

      expect(result.drift).toHaveLength(1);
      expect(result.drift[0]).toMatchObject({
        sku: variant.sku,
        stockQty: 99,
        ledgerTotal: 10,
        difference: 89,
      });
    });

    it("reports without changing anything by default", async () => {
      const variant = await makeVariant(10);
      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 99 } });

      const result = await reconcileStock(db);

      expect(result.repaired).toBe(false);
      // A silent repair would hide the bug that caused the drift.
      expect(
        (await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQty
      ).toBe(99);
    });

    it("rebuilds stockQty from the ledger when asked", async () => {
      const variant = await makeVariant(10);
      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 99 } });

      const result = await reconcileStock(db, { repair: true });

      expect(result.repaired).toBe(true);
      expect(
        (await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQty
      ).toBe(10);
      // And a second pass finds nothing.
      expect((await reconcileStock(db)).drift).toEqual([]);
    });

    it("treats a variant with no movements as zero, not as unknown", async () => {
      const product = await db.product.create({
        data: {
          name: unique("Ledgerless"),
          slug: unique("ledgerless"),
          variants: {
            create: {
              sku: unique("NOLEDGER").toUpperCase(),
              name: "Default",
              priceCents: 100,
              stockQty: 7,
            },
          },
        },
        include: { variants: true },
      });

      const result = await reconcileStock(db);
      const drift = result.drift.find((d) => d.variantId === product.variants[0]?.id);

      expect(drift).toMatchObject({ stockQty: 7, ledgerTotal: 0, difference: 7 });
    });
  });
});
