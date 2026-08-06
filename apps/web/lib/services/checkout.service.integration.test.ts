import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addItem, applyCoupon, getOrCreateCart, priceCart } from "./cart.service";
import { type CheckoutIdentity, startCheckout, validateCheckout } from "./checkout.service";
import { validateCoupon } from "./coupon.service";
import { availableStock } from "./reservation.service";

/**
 * The P3-02 acceptance criteria against a real database.
 *
 * The one that matters most is the first: a tampered payload must change nothing about what
 * the customer is charged.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.couponRedemption.deleteMany();
  await db.orderEvent.deleteMany();
  await db.payment.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.stockReservation.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.inventoryMovement.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.coupon.deleteMany();
  await db.shippingRate.deleteMany();
  await db.shippingZone.deleteMany();
  await db.user.deleteMany();
}

async function makeVariant(stock: number, priceCents = 100_000, weightGrams = 500) {
  const product = await db.product.create({
    data: {
      name: unique("Product"),
      slug: unique("product"),
      status: "active",
      variants: {
        create: {
          sku: unique("SKU").toUpperCase(),
          name: "Default",
          priceCents,
          stockQty: stock,
          weightGrams,
        },
      },
    },
    include: { variants: true },
  });
  const variant = product.variants[0];
  if (!variant) throw new Error("setup failed");
  return variant;
}

async function makeZone() {
  await db.shippingZone.create({
    data: {
      name: "Metro Manila",
      regions: ["NCR"],
      rates: {
        create: {
          name: "Standard",
          baseCents: 8_000,
          perKgCents: 0,
          freeAboveCents: 250_000,
          etaDaysMin: 1,
          etaDaysMax: 3,
        },
      },
    },
  });

  return db.shippingRate.findFirstOrThrow();
}

const ADDRESS = {
  recipient: "Joel Santos",
  phone: "09171234567",
  region: "NCR",
  province: "Metro Manila",
  city: "Quezon City",
  barangay: "Bagumbayan",
  street: "24 Sampaguita Street",
  postalCode: "1109",
};

const GUEST: CheckoutIdentity = {
  userId: null,
  email: "guest@example.test",
  name: "Joel Santos",
  phone: "09171234567",
  isMember: false,
  memberPercent: 0,
};

describeIntegration("checkout.service", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("client-supplied prices are ignored", () => {
    it("charges the catalog price, not what the browser claims it saw", async () => {
      // The tampering test the build plan asks for. `seenSubtotalCents` is the only price
      // the client can send at all, and it is used purely to decide whether to warn.
      const variant = await makeVariant(10, 100_000);
      const rate = await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 2);

      const result = await validateCheckout(db, cartId, GUEST, ADDRESS, {
        shippingRateId: rate.id,
        seenSubtotalCents: 1, // "this basket costs one centavo"
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      expect(result.quote.subtotalCents).toBe(200_000);
      // And the lie is surfaced to the customer rather than accepted.
      expect(result.quote.changes.some((change) => change.kind === "price_changed")).toBe(true);
    });

    it("writes the catalog price onto the order, whatever the request said", async () => {
      const variant = await makeVariant(10, 125_000);
      const rate = await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);

      const started = await startCheckout(cartId, GUEST, ADDRESS, rate.id, new Date(), db);
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const order = await db.order.findUniqueOrThrow({
        where: { id: started.orderId },
        include: { items: true },
      });

      expect(order.items[0]?.unitPriceCents).toBe(125_000);
      expect(order.subtotalCents).toBe(125_000);
      // Invariant I1.
      expect(order.totalCents).toBe(
        order.subtotalCents + order.shippingCents - order.discountCents
      );
      // Invariant I2.
      expect(order.items[0]?.lineTotalCents).toBe(
        (order.items[0]?.unitPriceCents ?? 0) * (order.items[0]?.quantity ?? 0)
      );
    });
  });

  describe("changes are surfaced before payment", () => {
    it("reports a price change since the cart was opened", async () => {
      const variant = await makeVariant(10, 100_000);
      const rate = await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);

      await db.productVariant.update({
        where: { id: variant.id },
        data: { priceCents: 150_000 },
      });

      const result = await validateCheckout(db, cartId, GUEST, ADDRESS, {
        shippingRateId: rate.id,
        seenSubtotalCents: 100_000,
      });

      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.quote.subtotalCents).toBe(150_000);
      expect(result.quote.changes.map((c) => c.kind)).toContain("price_changed");
    });

    it("reports a reduced quantity rather than silently charging for fewer", async () => {
      const variant = await makeVariant(10, 50_000);
      const rate = await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 5);

      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 2 } });

      const result = await validateCheckout(db, cartId, GUEST, ADDRESS, {
        shippingRateId: rate.id,
      });

      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.quote.changes.map((c) => c.kind)).toContain("stock_reduced");
      expect(result.quote.subtotalCents).toBe(100_000);
    });

    it("blocks entirely when a line is no longer available", async () => {
      const variant = await makeVariant(5);
      const rate = await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);

      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 0 } });

      const result = await validateCheckout(db, cartId, GUEST, ADDRESS, {
        shippingRateId: rate.id,
      });
      expect(result.kind).toBe("unavailable_lines");
    });

    it("refuses a region with no shipping zone", async () => {
      const variant = await makeVariant(5);
      await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);

      const result = await validateCheckout(
        db,
        cartId,
        GUEST,
        { ...ADDRESS, region: "Region VII" },
        {}
      );
      expect(result.kind).toBe("no_service");
    });
  });

  describe("coupon rules", () => {
    async function makeCoupon(data: Partial<Parameters<typeof db.coupon.create>[0]["data"]> = {}) {
      return db.coupon.create({
        data: {
          code: unique("CODE").toUpperCase(),
          type: "percentage",
          percentage: 10,
          ...data,
        } as Parameters<typeof db.coupon.create>[0]["data"],
      });
    }

    const context = { subtotalCents: 200_000, shippingCents: 8_000, isMember: false };

    it("accepts a valid code", async () => {
      const coupon = await makeCoupon();
      const result = await validateCoupon(db, coupon.code, context);

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.applied.discountCents).toBe(20_000);
    });

    it("rejects an unknown code", async () => {
      expect((await validateCoupon(db, "NOPE", context)).kind).toBe("rejected");
    });

    it("rejects an inactive code", async () => {
      const coupon = await makeCoupon({ isActive: false });
      const result = await validateCoupon(db, coupon.code, context);
      expect(result).toMatchObject({ kind: "rejected", reason: "inactive" });
    });

    it("rejects an expired code", async () => {
      const coupon = await makeCoupon({ endsAt: new Date(Date.now() - 1000) });
      const result = await validateCoupon(db, coupon.code, context);
      expect(result).toMatchObject({ kind: "rejected", reason: "expired" });
    });

    it("rejects a code that has not started", async () => {
      const coupon = await makeCoupon({ startsAt: new Date(Date.now() + 86_400_000) });
      const result = await validateCoupon(db, coupon.code, context);
      expect(result).toMatchObject({ kind: "rejected", reason: "not_started" });
    });

    it("enforces the minimum subtotal", async () => {
      const coupon = await makeCoupon({ minSubtotalCents: 300_000 });
      const result = await validateCoupon(db, coupon.code, context);
      expect(result).toMatchObject({ kind: "rejected", reason: "below_minimum" });
    });

    it("enforces the global usage cap", async () => {
      const coupon = await makeCoupon({ maxUses: 5, usedCount: 5 });
      const result = await validateCoupon(db, coupon.code, context);
      expect(result).toMatchObject({ kind: "rejected", reason: "usage_limit_reached" });
    });

    it("enforces the per-user cap", async () => {
      const coupon = await makeCoupon({ maxUsesPerUser: 1 });
      const user = await db.user.create({
        data: { name: "Joel", email: `${unique("u")}@example.test` },
      });
      const order = await db.order.create({
        data: {
          orderNo: unique("TS-C"),
          subtotalCents: 1,
          totalCents: 1,
          shippingAddress: {},
          customerName: "Joel",
          customerEmail: "joel@example.test",
          customerPhone: "09171234567",
        },
      });
      await db.couponRedemption.create({
        data: { couponId: coupon.id, userId: user.id, orderId: order.id, discountCents: 100 },
      });

      const result = await validateCoupon(db, coupon.code, { ...context, userId: user.id });
      expect(result).toMatchObject({ kind: "rejected", reason: "already_used_by_you" });
    });

    it("enforces members-only", async () => {
      const coupon = await makeCoupon({ membersOnly: true });

      expect(await validateCoupon(db, coupon.code, context)).toMatchObject({
        kind: "rejected",
        reason: "members_only",
      });
      expect((await validateCoupon(db, coupon.code, { ...context, isMember: true })).kind).toBe(
        "ok"
      );
    });

    it("never discounts more than the basket is worth", async () => {
      // A â‚±5,000 fixed coupon on a â‚±2,000 basket must not produce a negative total.
      const coupon = await makeCoupon({ type: "fixed", percentage: null, valueCents: 500_000 });
      const result = await validateCoupon(db, coupon.code, { ...context, subtotalCents: 200_000 });

      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.applied.discountCents).toBe(200_000);
    });

    it("stops discounting when the code expires while sitting on the cart", async () => {
      const variant = await makeVariant(10, 200_000);
      const coupon = await makeCoupon();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);
      await applyCoupon(db, cartId, coupon.code, { subtotalCents: 200_000 });

      expect((await priceCart(db, cartId)).discountCents).toBe(20_000);

      await db.coupon.update({
        where: { id: coupon.id },
        data: { endsAt: new Date(Date.now() - 1000) },
      });

      const after = await priceCart(db, cartId);
      expect(after.discountCents).toBe(0);
      // And the customer is told why rather than just seeing the price go up.
      expect(after.couponMessage).toContain("expired");
    });

    it("applies the discount to the order total", async () => {
      const variant = await makeVariant(10, 200_000);
      const rate = await makeZone();
      const coupon = await makeCoupon();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);
      await applyCoupon(db, cartId, coupon.code, { subtotalCents: 200_000 });

      const started = await startCheckout(cartId, GUEST, ADDRESS, rate.id, new Date(), db);
      if (started.kind !== "ok") throw new Error("expected ok");

      const order = await db.order.findUniqueOrThrow({ where: { id: started.orderId } });
      expect(order.discountCents).toBe(20_000);
      expect(order.couponCode).toBe(coupon.code);
      expect(order.totalCents).toBe(
        order.subtotalCents + order.shippingCents - order.discountCents
      );
    });

    it("drops a coupon claimed by someone else, and still places the order", async () => {
      /**
       * The claim, wired in. Another checkout took the only use between this cart applying
       * the code and this checkout committing.
       *
       * Being charged full price is a surprise, but losing a finished checkout over a voucher
       * is a worse one — so the order stands and the change is reported.
       */
      const variant = await makeVariant(10, 200_000);
      const rate = await makeZone();
      const coupon = await makeCoupon({ maxUses: 1 });
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);
      await applyCoupon(db, cartId, coupon.code, { subtotalCents: 200_000 });

      // Someone else's checkout, holding the only use.
      await db.order.create({
        data: {
          orderNo: unique("TS-RIVAL").toUpperCase(),
          paymentStatus: "awaiting_payment",
          subtotalCents: 200_000,
          totalCents: 180_000,
          couponCode: coupon.code,
          shippingAddress: {},
          customerName: "Someone Else",
          customerEmail: "else@example.test",
          customerPhone: "09170000000",
          placedAt: new Date(),
        },
      });

      const started = await startCheckout(cartId, GUEST, ADDRESS, rate.id, new Date(), db);
      if (started.kind !== "ok") throw new Error("expected ok");

      expect(started.changes.some((change) => change.kind === "coupon_invalid")).toBe(true);

      const order = await db.order.findUniqueOrThrow({ where: { id: started.orderId } });
      expect(order.couponCode).toBeNull();
      expect(order.discountCents).toBe(0);
      // The total is the honest one, not the discounted figure the cart last showed.
      expect(order.totalCents).toBe(order.subtotalCents + order.shippingCents);
    });

    it("does not record a code on the order when it discounted nothing", async () => {
      // Otherwise the order reads as a use of the coupon to the cap and to the paid webhook,
      // and the customer burns a code they never got anything from.
      const variant = await makeVariant(10, 200_000);
      const rate = await makeZone();
      const coupon = await makeCoupon();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);
      await applyCoupon(db, cartId, coupon.code, { subtotalCents: 200_000 });

      await db.coupon.update({
        where: { id: coupon.id },
        data: { endsAt: new Date(Date.now() - 1000) },
      });

      const started = await startCheckout(cartId, GUEST, ADDRESS, rate.id, new Date(), db);
      if (started.kind !== "ok") throw new Error("expected ok");

      const order = await db.order.findUniqueOrThrow({ where: { id: started.orderId } });
      expect(order.couponCode).toBeNull();
      expect(order.discountCents).toBe(0);
    });

    it("keeps the coupon when nobody else is holding it", async () => {
      const variant = await makeVariant(10, 200_000);
      const rate = await makeZone();
      const coupon = await makeCoupon({ maxUses: 1 });
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);
      await applyCoupon(db, cartId, coupon.code, { subtotalCents: 200_000 });

      const started = await startCheckout(cartId, GUEST, ADDRESS, rate.id, new Date(), db);
      if (started.kind !== "ok") throw new Error("expected ok");

      expect(started.changes).toHaveLength(0);
      const order = await db.order.findUniqueOrThrow({ where: { id: started.orderId } });
      expect(order.couponCode).toBe(coupon.code);
      expect(order.discountCents).toBe(20_000);
    });
  });

  describe("guest checkout end to end", () => {
    it("creates a pending order with reserved stock and no user", async () => {
      const variant = await makeVariant(5, 100_000);
      const rate = await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 2);

      const started = await startCheckout(cartId, GUEST, ADDRESS, rate.id, new Date(), db);
      expect(started.kind).toBe("ok");
      if (started.kind !== "ok") return;

      const order = await db.order.findUniqueOrThrow({
        where: { id: started.orderId },
        include: { items: true, events: true },
      });

      expect(order.userId).toBeNull();
      expect(order.guestEmail).toBe("guest@example.test");
      expect(order.status).toBe("pending");
      expect(order.paymentStatus).toBe("awaiting_payment");
      expect(order.orderNo).toMatch(/^TS-\d{4}-\d{6}$/);
      expect(order.events).toHaveLength(1);

      // Stock is reserved, not decremented â€” the sale is recorded on the paid webhook.
      const variantAfter = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.stockQty).toBe(5);
      expect(await availableStock(db, variant.id)).toBe(3);

      // The address is frozen onto the order.
      expect(order.shippingAddress).toMatchObject({ city: "Quezon City" });
    });

    it("applies free shipping at the threshold", async () => {
      const variant = await makeVariant(5, 250_000);
      const rate = await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);

      const started = await startCheckout(cartId, GUEST, ADDRESS, rate.id, new Date(), db);
      if (started.kind !== "ok") throw new Error("expected ok");

      const order = await db.order.findUniqueOrThrow({ where: { id: started.orderId } });
      expect(order.shippingCents).toBe(0);
    });

    it("numbers orders sequentially", async () => {
      const variant = await makeVariant(10);
      const rate = await makeZone();

      const first = await startCheckout(
        await (async () => {
          const id = await getOrCreateCart(db, { guestToken: unique("g") });
          await addItem(db, id, variant.id, 1);
          return id;
        })(),
        GUEST,
        ADDRESS,
        rate.id,
        new Date(),
        db
      );

      const second = await startCheckout(
        await (async () => {
          const id = await getOrCreateCart(db, { guestToken: unique("g") });
          await addItem(db, id, variant.id, 1);
          return id;
        })(),
        GUEST,
        ADDRESS,
        rate.id,
        new Date(),
        db
      );

      if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected ok");
      expect(Number(second.orderNo.slice(-6))).toBe(Number(first.orderNo.slice(-6)) + 1);
    });

    it("refuses when someone else takes the last unit first", async () => {
      const variant = await makeVariant(1);
      const rate = await makeZone();

      const cartA = await getOrCreateCart(db, { guestToken: unique("a") });
      await addItem(db, cartA, variant.id, 1);
      const cartB = await getOrCreateCart(db, { guestToken: unique("b") });
      await addItem(db, cartB, variant.id, 1);

      const first = await startCheckout(cartA, GUEST, ADDRESS, rate.id, new Date(), db);
      const second = await startCheckout(cartB, GUEST, ADDRESS, rate.id, new Date(), db);

      expect(first.kind).toBe("ok");
      // Before payment, which is the whole point.
      expect(second.kind).toBe("out_of_stock");
      expect(await db.order.count()).toBe(1);
    });

    it("refuses an empty cart", async () => {
      await makeZone();
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      expect((await startCheckout(cartId, GUEST, ADDRESS, null, new Date(), db)).kind).toBe(
        "empty_cart"
      );
    });
  });
});
