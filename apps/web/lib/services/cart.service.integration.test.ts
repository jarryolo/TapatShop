import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addItem,
  cartExpiry,
  getOrCreateCart,
  mergeGuestCart,
  priceCart,
  removeItem,
  updateItemQuantity,
} from "./cart.service";

/**
 * The P2-04 acceptance criteria, against a real database. In particular the one the build
 * plan calls out by name: an item going out of stock while it sits in the cart.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.inventoryMovement.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

async function makeVariant(stock: number, priceCents = 100_000) {
  const product = await db.product.create({
    data: {
      name: unique("Product"),
      slug: unique("product"),
      status: "active",
      variants: {
        create: { sku: unique("SKU").toUpperCase(), name: "Default", priceCents, stockQty: stock },
      },
    },
    include: { variants: true },
  });

  const variant = product.variants[0];
  if (!variant) throw new Error("setup failed");
  return variant;
}

describeIntegration("cart.service", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("guest cart persistence", () => {
    it("keeps the same cart for a returning guest token", async () => {
      const token = unique("guest");
      const first = await getOrCreateCart(db, { guestToken: token });
      const second = await getOrCreateCart(db, { guestToken: token });

      expect(second).toBe(first);
    });

    it("expires 30 days out, so a closed browser does not lose the basket", async () => {
      const now = new Date("2026-08-06T00:00:00.000Z");
      const expiry = cartExpiry(now);
      const days = (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

      expect(days).toBe(30);
    });

    it("pushes the expiry forward when the cart is used", async () => {
      const token = unique("guest-touch");
      const cartId = await getOrCreateCart(db, { guestToken: token });
      const variant = await makeVariant(10);

      await db.cart.update({
        where: { id: cartId },
        data: { expiresAt: new Date("2026-08-07T00:00:00.000Z") },
      });

      await addItem(db, cartId, variant.id, 1);

      const cart = await db.cart.findUniqueOrThrow({ where: { id: cartId } });
      expect(cart.expiresAt.getTime()).toBeGreaterThan(
        new Date("2026-08-07T00:00:00.000Z").getTime()
      );
    });
  });

  describe("adding and clamping", () => {
    it("clamps to available stock and reports it", async () => {
      const variant = await makeVariant(3);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });

      const result = await addItem(db, cartId, variant.id, 10);

      expect(result).toMatchObject({ kind: "ok", quantity: 3, clamped: true, available: 3 });
    });

    it("tops up an existing line rather than adding a second one", async () => {
      const variant = await makeVariant(10);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });

      await addItem(db, cartId, variant.id, 2);
      await addItem(db, cartId, variant.id, 3);

      const items = await db.cartItem.findMany({ where: { cartId } });
      expect(items).toHaveLength(1);
      expect(items[0]?.quantity).toBe(5);
    });

    it("refuses an out-of-stock variant", async () => {
      const variant = await makeVariant(0);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });

      expect((await addItem(db, cartId, variant.id, 1)).kind).toBe("out_of_stock");
    });

    it("refuses a draft product's variant", async () => {
      const variant = await makeVariant(5);
      await db.product.update({ where: { id: variant.productId }, data: { status: "draft" } });
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });

      expect((await addItem(db, cartId, variant.id, 1)).kind).toBe("unavailable");
    });

    it("removes the line when the quantity is set to zero", async () => {
      const variant = await makeVariant(5);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 2);
      const item = await db.cartItem.findFirstOrThrow({ where: { cartId } });

      expect((await updateItemQuantity(db, cartId, item.id, 0)).kind).toBe("removed");
      expect(await db.cartItem.count({ where: { cartId } })).toBe(0);
    });

    it("will not touch a line belonging to someone else's cart", async () => {
      const variant = await makeVariant(5);
      const mine = await getOrCreateCart(db, { guestToken: unique("mine") });
      const theirs = await getOrCreateCart(db, { guestToken: unique("theirs") });
      await addItem(db, theirs, variant.id, 1);
      const theirItem = await db.cartItem.findFirstOrThrow({ where: { cartId: theirs } });

      expect((await updateItemQuantity(db, mine, theirItem.id, 5)).kind).toBe("not_found");
      expect(await removeItem(db, mine, theirItem.id)).toBe(false);
    });
  });

  describe("pricing", () => {
    it("recomputes from the catalog, so a price change is picked up", async () => {
      const variant = await makeVariant(10, 100_000);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 2);

      expect((await priceCart(db, cartId)).subtotalCents).toBe(200_000);

      await db.productVariant.update({
        where: { id: variant.id },
        data: { priceCents: 150_000 },
      });

      // Nothing was stored, so the new price is simply what the next read returns.
      expect((await priceCart(db, cartId)).subtotalCents).toBe(300_000);
    });

    it("applies the member discount per unit", async () => {
      const variant = await makeVariant(10, 125_000);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 2);

      const priced = await priceCart(db, cartId, 10);

      expect(priced.lines[0]?.unitPriceCents).toBe(112_500);
      expect(priced.lines[0]?.lineTotalCents).toBe(225_000);
      expect(priced.lines[0]?.listPriceCents).toBe(125_000);
    });

    it("prices an empty cart at zero without throwing", async () => {
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      expect(await priceCart(db, cartId)).toMatchObject({ subtotalCents: 0, itemCount: 0 });
    });
  });

  describe("stock changing while the item sits in the cart", () => {
    it("shows an out-of-stock line clearly and charges nothing for it", async () => {
      // The scenario the build plan names explicitly.
      const variant = await makeVariant(5);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 2);

      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 0 } });

      const priced = await priceCart(db, cartId);

      expect(priced.hasIssues).toBe(true);
      expect(priced.lines[0]?.issue).toEqual({ kind: "out_of_stock" });
      // Still listed — a cart that silently drops items is worse than one that explains.
      expect(priced.lines).toHaveLength(1);
      expect(priced.lines[0]?.lineTotalCents).toBe(0);
      expect(priced.subtotalCents).toBe(0);
      expect(priced.itemCount).toBe(0);
    });

    it("reduces a line to what is left and says what happened", async () => {
      const variant = await makeVariant(10, 50_000);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 5);

      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 2 } });

      const priced = await priceCart(db, cartId);

      expect(priced.lines[0]?.issue).toEqual({ kind: "reduced", available: 2, requested: 5 });
      // Charged for what exists, so the subtotal is never a promise stock cannot keep.
      expect(priced.lines[0]?.lineTotalCents).toBe(100_000);
    });

    it("flags a product that was unpublished while in the cart", async () => {
      const variant = await makeVariant(5);
      const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
      await addItem(db, cartId, variant.id, 1);

      await db.product.update({ where: { id: variant.productId }, data: { status: "archived" } });

      const priced = await priceCart(db, cartId);
      expect(priced.lines[0]?.issue).toEqual({ kind: "unavailable" });
      expect(priced.subtotalCents).toBe(0);
    });
  });

  describe("merging a guest cart at login", () => {
    async function makeUser() {
      return db.user.create({
        data: { name: "Joel", email: `${unique("merge")}@example.test` },
      });
    }

    it("sums quantities for a variant that is in both carts, without duplicating the line", async () => {
      // docs/03 names this as where duplicate-line bugs hide.
      const variant = await makeVariant(10);
      const user = await makeUser();
      const token = unique("guest");

      const userCart = await getOrCreateCart(db, { userId: user.id });
      await addItem(db, userCart, variant.id, 2);

      const guestCart = await getOrCreateCart(db, { guestToken: token });
      await addItem(db, guestCart, variant.id, 3);

      await mergeGuestCart(db, token, user.id);

      const items = await db.cartItem.findMany({ where: { cartId: userCart } });
      expect(items).toHaveLength(1);
      expect(items[0]?.quantity).toBe(5);
    });

    it("clamps the summed quantity to available stock", async () => {
      const variant = await makeVariant(4);
      const user = await makeUser();
      const token = unique("guest");

      const userCart = await getOrCreateCart(db, { userId: user.id });
      await addItem(db, userCart, variant.id, 3);
      const guestCart = await getOrCreateCart(db, { guestToken: token });
      await addItem(db, guestCart, variant.id, 3);

      const summary = await mergeGuestCart(db, token, user.id);

      expect(summary.clamped).toBe(1);
      const item = await db.cartItem.findFirstOrThrow({ where: { cartId: userCart } });
      expect(item.quantity).toBe(4);
    });

    it("carries over a variant the user did not already have", async () => {
      const [a, b] = [await makeVariant(10), await makeVariant(10)];
      const user = await makeUser();
      const token = unique("guest");

      const userCart = await getOrCreateCart(db, { userId: user.id });
      await addItem(db, userCart, a.id, 1);
      const guestCart = await getOrCreateCart(db, { guestToken: token });
      await addItem(db, guestCart, b.id, 2);

      await mergeGuestCart(db, token, user.id);

      const items = await db.cartItem.findMany({ where: { cartId: userCart } });
      expect(items).toHaveLength(2);
    });

    it("deletes the guest cart afterwards", async () => {
      const variant = await makeVariant(5);
      const user = await makeUser();
      const token = unique("guest");
      await addItem(db, await getOrCreateCart(db, { guestToken: token }), variant.id, 1);

      await mergeGuestCart(db, token, user.id);

      expect(await db.cart.findUnique({ where: { guestToken: token } })).toBeNull();
    });

    it("skips items that stopped being sellable while the cookie sat there", async () => {
      const variant = await makeVariant(5);
      const user = await makeUser();
      const token = unique("guest");
      await addItem(db, await getOrCreateCart(db, { guestToken: token }), variant.id, 2);

      await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 0 } });

      const summary = await mergeGuestCart(db, token, user.id);

      expect(summary.merged).toBe(0);
      const userCart = await getOrCreateCart(db, { userId: user.id });
      expect(await db.cartItem.count({ where: { cartId: userCart } })).toBe(0);
    });

    it("is a no-op for a guest token with no cart", async () => {
      const user = await makeUser();
      expect(await mergeGuestCart(db, unique("nothing"), user.id)).toEqual({
        merged: 0,
        clamped: 0,
      });
    });

    it("is safe to run twice", async () => {
      // The provider calls merge on every signed-in page load.
      const variant = await makeVariant(10);
      const user = await makeUser();
      const token = unique("guest");
      await addItem(db, await getOrCreateCart(db, { guestToken: token }), variant.id, 2);

      await mergeGuestCart(db, token, user.id);
      await mergeGuestCart(db, token, user.id);

      const userCart = await getOrCreateCart(db, { userId: user.id });
      const items = await db.cartItem.findMany({ where: { cartId: userCart } });
      expect(items).toHaveLength(1);
      expect(items[0]?.quantity).toBe(2);
    });
  });
});
