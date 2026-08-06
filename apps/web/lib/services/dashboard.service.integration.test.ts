import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  awaitingActionSample,
  dashboardFigures,
  lowStockSample,
  manilaDay,
  manilaWeek,
  topProductsThisWeek,
} from "./dashboard.service";

/**
 * The P4-06 acceptance criterion: dashboard figures reconcile against a manual query.
 *
 * So every test here computes the expected number a second way — by counting rows it created,
 * or by a query written independently of the service — and compares. A test that asserted a
 * hardcoded number would pass just as happily against a figure capped at eight, which is
 * exactly the bug this service was written to fix.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

/** Midday Manila, so a day's boundaries are unambiguous whatever the runner's clock says. */
const NOW = new Date("2026-08-07T04:00:00.000Z");

async function wipe() {
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.category.deleteMany();
}

async function makeVariant(stockQty: number, lowStockThreshold = 5) {
  const product = await db.product.create({
    data: {
      name: unique("Polo"),
      slug: unique("polo").toLowerCase(),
      status: "active",
      description: "",
    },
  });

  return db.productVariant.create({
    data: {
      productId: product.id,
      sku: unique("SKU").toUpperCase(),
      name: "Default",
      priceCents: 100_000,
      stockQty,
      lowStockThreshold,
      isActive: true,
    },
    include: { product: true },
  });
}

interface OrderSpec {
  paidAt?: Date | null;
  placedAt?: Date;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  status?: string;
  totalCents?: number;
  refundedCents?: number;
}

async function makeOrder(spec: OrderSpec = {}) {
  return db.order.create({
    data: {
      orderNo: unique("TS-D").toUpperCase(),
      paymentStatus: (spec.paymentStatus ?? "paid") as never,
      fulfillmentStatus: (spec.fulfillmentStatus ?? "unfulfilled") as never,
      status: (spec.status ?? "confirmed") as never,
      subtotalCents: spec.totalCents ?? 100_000,
      totalCents: spec.totalCents ?? 100_000,
      refundedCents: spec.refundedCents ?? 0,
      paidAt: spec.paidAt === undefined ? NOW : spec.paidAt,
      placedAt: spec.placedAt ?? NOW,
      createdAt: spec.placedAt ?? NOW,
      shippingAddress: {},
      customerName: "Joel Santos",
      customerEmail: "joel@example.test",
      customerPhone: "09171234567",
    },
  });
}

describeIntegration("dashboard.service", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("the Manila day", () => {
    it("starts at 00:00 Manila, which is 16:00 UTC the day before", () => {
      const { start, end } = manilaDay(NOW);
      expect(start.toISOString()).toBe("2026-08-06T16:00:00.000Z");
      expect(end.toISOString()).toBe("2026-08-07T15:59:59.999Z");
    });

    it("keeps an early-morning Manila order inside today", () => {
      // 07:00 Manila on the 7th is 23:00 UTC on the 6th. On UTC days this order vanishes.
      const earlyManila = new Date("2026-08-06T23:00:00.000Z");
      const { start, end } = manilaDay(NOW);
      expect(earlyManila >= start && earlyManila <= end).toBe(true);
    });

    it("covers seven days ending today", () => {
      const week = manilaWeek(NOW);
      expect(week.end).toEqual(manilaDay(NOW).end);
      expect((week.end.getTime() - week.start.getTime()) / 86_400_000).toBeCloseTo(7, 1);
    });
  });

  describe("sales today", () => {
    it("reconciles against a sum of the orders created", async () => {
      const amounts = [
        { totalCents: 150_000, refundedCents: 0 },
        { totalCents: 80_000, refundedCents: 20_000, paymentStatus: "partially_refunded" },
        { totalCents: 45_500, refundedCents: 0 },
      ];
      for (const amount of amounts) await makeOrder(amount);

      // Yesterday, and an unpaid one today. Neither is today's revenue.
      await makeOrder({ paidAt: new Date("2026-08-05T04:00:00.000Z"), totalCents: 999_999 });
      await makeOrder({ paidAt: null, paymentStatus: "awaiting_payment", totalCents: 777_777 });

      const expected = amounts.reduce(
        (sum, amount) => sum + amount.totalCents - amount.refundedCents,
        0
      );

      const figures = await dashboardFigures(db, NOW);
      expect(figures.salesTodayCents).toBe(expected);
      expect(figures.paidOrdersToday).toBe(3);
    });

    it("subtracts refunds rather than showing the gross", async () => {
      await makeOrder({ totalCents: 100_000, refundedCents: 100_000, paymentStatus: "refunded" });

      // A fully refunded day is not a good day, and the dashboard must not say it was.
      expect((await dashboardFigures(db, NOW)).salesTodayCents).toBe(0);
    });

    it("never goes negative", async () => {
      await makeOrder({ totalCents: 10_000, refundedCents: 15_000, paymentStatus: "refunded" });
      expect((await dashboardFigures(db, NOW)).salesTodayCents).toBe(0);
    });
  });

  describe("awaiting action", () => {
    it("counts every one, not just the page shown beside it", async () => {
      // Twelve is deliberately more than the eight-row sample. The old dashboard reported the
      // length of that sample, so this count read 8 no matter how deep the queue was.
      for (let i = 0; i < 12; i += 1) await makeOrder({});

      const figures = await dashboardFigures(db, NOW);
      const manual = await db.order.count({
        where: {
          paymentStatus: "paid",
          fulfillmentStatus: "unfulfilled",
          status: { not: "cancelled" },
        },
      });

      expect(figures.awaitingActionCount).toBe(12);
      expect(figures.awaitingActionCount).toBe(manual);
      expect(await awaitingActionSample(db)).toHaveLength(8);
    });

    it("ignores unpaid, cancelled and already-packed orders", async () => {
      await makeOrder({});
      await makeOrder({ paymentStatus: "awaiting_payment", paidAt: null });
      await makeOrder({ status: "cancelled" });
      await makeOrder({ fulfillmentStatus: "packed" });

      expect((await dashboardFigures(db, NOW)).awaitingActionCount).toBe(1);
    });

    it("shows the longest-waiting order first", async () => {
      const old = await makeOrder({ placedAt: new Date("2026-08-01T04:00:00.000Z") });
      await makeOrder({ placedAt: new Date("2026-08-07T04:00:00.000Z") });

      expect((await awaitingActionSample(db))[0]?.id).toBe(old.id);
    });
  });

  describe("low stock", () => {
    it("counts against each variant's own threshold, not one number for all", async () => {
      await makeVariant(3, 5); // low
      await makeVariant(9, 10); // low, but only because its threshold is higher
      await makeVariant(9, 5); // fine
      await makeVariant(0, 5); // low, and out

      const figures = await dashboardFigures(db, NOW);
      expect(figures.lowStockCount).toBe(3);
      expect(figures.outOfStockCount).toBe(1);
    });

    it("counts every one, not just the page shown beside it", async () => {
      for (let i = 0; i < 11; i += 1) await makeVariant(1, 5);

      expect((await dashboardFigures(db, NOW)).lowStockCount).toBe(11);
      expect(await lowStockSample(db)).toHaveLength(8);
    });

    it("ignores draft products and inactive variants", async () => {
      const hidden = await makeVariant(1, 5);
      await db.product.update({ where: { id: hidden.productId }, data: { status: "draft" } });

      const off = await makeVariant(1, 5);
      await db.productVariant.update({ where: { id: off.id }, data: { isActive: false } });

      await makeVariant(1, 5);

      expect((await dashboardFigures(db, NOW)).lowStockCount).toBe(1);
    });

    it("lists the most urgent first", async () => {
      await makeVariant(4, 5);
      const worst = await makeVariant(0, 5);
      await makeVariant(2, 5);

      expect((await lowStockSample(db))[0]?.id).toBe(worst.id);
    });
  });

  describe("top products this week", () => {
    async function sell(variantId: string, quantity: number, paidAt: Date) {
      const order = await makeOrder({ paidAt, placedAt: paidAt });
      await db.orderItem.create({
        data: {
          orderId: order.id,
          variantId,
          productName: "Product",
          variantName: "Default",
          sku: unique("S").toUpperCase(),
          unitPriceCents: 100_000,
          quantity,
          lineTotalCents: 100_000 * quantity,
        },
      });
    }

    it("ranks by units sold and reconciles against a manual sum", async () => {
      const coffee = await makeVariant(100);
      const polo = await makeVariant(100);

      await sell(coffee.id, 4, NOW);
      await sell(coffee.id, 3, new Date("2026-08-05T04:00:00.000Z"));
      await sell(polo.id, 2, NOW);

      const top = await topProductsThisWeek(db, NOW);

      const manual = await db.orderItem.aggregate({
        where: { variantId: coffee.id },
        _sum: { quantity: true },
      });

      expect(top[0]?.variantId).toBe(coffee.id);
      expect(top[0]?.unitsSold).toBe(7);
      expect(top[0]?.unitsSold).toBe(manual._sum.quantity);
      expect(top[1]?.variantId).toBe(polo.id);
    });

    it("ignores sales older than the week and sales that were never paid", async () => {
      const variant = await makeVariant(100);
      await sell(variant.id, 50, new Date("2026-07-01T04:00:00.000Z"));

      expect(await topProductsThisWeek(db, NOW)).toHaveLength(0);
    });

    it("ranks by units, not revenue", async () => {
      // Forty bags of coffee beat one windbreaker, which is the restocking answer.
      const windbreaker = await makeVariant(100);
      const coffee = await makeVariant(100);

      const expensive = await makeOrder({});
      await db.orderItem.create({
        data: {
          orderId: expensive.id,
          variantId: windbreaker.id,
          productName: "Windbreaker",
          variantName: "L",
          sku: unique("W").toUpperCase(),
          unitPriceCents: 500_000,
          quantity: 1,
          lineTotalCents: 500_000,
        },
      });

      await sell(coffee.id, 40, NOW);

      expect((await topProductsThisWeek(db, NOW))[0]?.variantId).toBe(coffee.id);
    });
  });
});
