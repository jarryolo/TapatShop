import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listOrders, orderFor } from "./account.service";

/**
 * A customer's own order history.
 *
 * The property that matters is whose orders come back. An order carries a full delivery
 * address and phone number, so "my orders" leaking one row too many is a privacy incident,
 * not a display bug.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.user.deleteMany();
}

async function makeUser({ verified = true } = {}) {
  return db.user.create({
    data: {
      name: "Ramon",
      email: `${unique("u")}@example.test`,
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
}

/** A minimal but real order — snapshot columns filled, because that is what the list reads. */
async function makeOrder(input: {
  userId?: string | null;
  guestEmail?: string | null;
  email: string;
  total?: number;
  placedAt?: Date | null;
}) {
  return db.order.create({
    data: {
      orderNo: unique("TS-2026").toUpperCase(),
      userId: input.userId ?? null,
      guestEmail: input.guestEmail ?? null,
      customerName: "Ramon Reyes",
      customerEmail: input.email,
      customerPhone: "09171234567",
      shippingAddress: { street: "12 Mabini", city: "City of Cebu", province: "Cebu" },
      subtotalCents: input.total ?? 10_000,
      shippingCents: 0,
      discountCents: 0,
      totalCents: input.total ?? 10_000,
      placedAt: input.placedAt === undefined ? new Date() : input.placedAt,
      items: {
        create: {
          productName: "Barong Tagalog",
          variantName: "Medium",
          sku: unique("SKU"),
          unitPriceCents: input.total ?? 10_000,
          quantity: 1,
          lineTotalCents: input.total ?? 10_000,
        },
      },
    },
  });
}

describeIntegration("account service", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("whose orders come back", () => {
    it("lists the orders placed while signed in", async () => {
      const user = await makeUser();
      const order = await makeOrder({ userId: user.id, email: user.email });

      const listed = await listOrders(db, user.id);
      expect(listed.map((o) => o.orderNo)).toEqual([order.orderNo]);
    });

    it("never lists someone else's orders", async () => {
      const user = await makeUser();
      const other = await makeUser();
      await makeOrder({ userId: other.id, email: other.email });

      expect(await listOrders(db, user.id)).toEqual([]);
    });

    it("includes guest orders placed on the same verified email", async () => {
      // Otherwise someone who checked out as a guest and then registered sees an empty history
      // and concludes their order is lost.
      const user = await makeUser({ verified: true });
      const guestOrder = await makeOrder({ guestEmail: user.email, email: user.email });

      const listed = await listOrders(db, user.id);
      expect(listed.map((o) => o.orderNo)).toEqual([guestOrder.orderNo]);
    });

    it("withholds guest orders when the email is not verified", async () => {
      /**
       * The privacy boundary. An order holds a delivery address and a phone number, so
       * matching an unverified address would hand those to anyone who signs up claiming
       * someone else's email.
       */
      const user = await makeUser({ verified: false });
      await makeOrder({ guestEmail: user.email, email: user.email });

      expect(await listOrders(db, user.id)).toEqual([]);
    });

    it("still shows orders placed while signed in when the email is unverified", async () => {
      // The userId link is unambiguous — verification only gates the email match.
      const user = await makeUser({ verified: false });
      const order = await makeOrder({ userId: user.id, email: user.email });

      expect((await listOrders(db, user.id)).map((o) => o.orderNo)).toEqual([order.orderNo]);
    });
  });

  describe("the list", () => {
    it("puts the newest order first", async () => {
      const user = await makeUser();
      const older = await makeOrder({ userId: user.id, email: user.email });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newer = await makeOrder({ userId: user.id, email: user.email });

      const listed = await listOrders(db, user.id);
      expect(listed.map((o) => o.orderNo)).toEqual([newer.orderNo, older.orderNo]);
    });

    it("keeps an unpaid order in the list", async () => {
      // placedAt is null until payment confirms. Sorting on it alone drops the order the buyer
      // is most likely looking for right now to the bottom.
      const user = await makeUser();
      const unpaid = await makeOrder({ userId: user.id, email: user.email, placedAt: null });

      const listed = await listOrders(db, user.id);
      expect(listed.map((o) => o.orderNo)).toContain(unpaid.orderNo);
      expect(listed[0]?.placedAt).toBeNull();
    });

    it("counts items rather than lines", async () => {
      const user = await makeUser();
      const order = await makeOrder({ userId: user.id, email: user.email });
      await db.orderItem.create({
        data: {
          orderId: order.id,
          productName: "Sunday shoes",
          variantName: "42",
          sku: unique("SKU"),
          unitPriceCents: 5_000,
          quantity: 3,
          lineTotalCents: 15_000,
        },
      });

      expect((await listOrders(db, user.id))[0]?.itemCount).toBe(4);
    });
  });

  describe("one order", () => {
    it("loads an order the customer owns", async () => {
      const user = await makeUser();
      const order = await makeOrder({ userId: user.id, email: user.email });

      const loaded = await orderFor(db, user.id, order.orderNo);
      expect(loaded?.orderNo).toBe(order.orderNo);
      expect(loaded?.items).toHaveLength(1);
    });

    it("returns nothing for someone else's order number", async () => {
      const user = await makeUser();
      const other = await makeUser();
      const theirs = await makeOrder({ userId: other.id, email: other.email });

      // Null rather than a refusal, so the page 404s and cannot be used to discover which
      // order numbers exist.
      expect(await orderFor(db, user.id, theirs.orderNo)).toBeNull();
    });

    it("accepts a lowercase order number, because people retype them", async () => {
      const user = await makeUser();
      const order = await makeOrder({ userId: user.id, email: user.email });

      expect((await orderFor(db, user.id, order.orderNo.toLowerCase()))?.orderNo).toBe(
        order.orderNo
      );
    });

    it("withholds internal notes from the timeline", async () => {
      /**
       * Order events carry staff notes — "customer sounds unhappy, refund if pushed". The
       * select filters on isPublic, and this is the test that says so out loud.
       */
      const user = await makeUser();
      const order = await makeOrder({ userId: user.id, email: user.email });

      await db.orderEvent.createMany({
        data: [
          { orderId: order.id, type: "placed", message: "Order placed.", isPublic: true },
          { orderId: order.id, type: "note", message: "Internal: chase supplier", isPublic: false },
        ],
      });

      const loaded = await orderFor(db, user.id, order.orderNo);
      expect(loaded?.events.map((e) => e.message)).toEqual(["Order placed."]);
    });
  });
});
