import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addToWishlist,
  listWishlist,
  removeFromWishlist,
  wishlistProductIds,
} from "./wishlist.service";

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let userId = "";

async function wipe() {
  await db.wishlistItem.deleteMany();
  await db.productVariant.deleteMany();
  await db.productImage.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

async function makeProduct(stockQty = 5, status = "active") {
  const product = await db.product.create({
    data: {
      name: unique("Mug"),
      slug: unique("mug").toLowerCase(),
      status: status as never,
      description: "",
    },
  });

  await db.productVariant.create({
    data: {
      productId: product.id,
      sku: unique("SKU").toUpperCase(),
      name: "Default",
      priceCents: 50_000,
      stockQty,
      isActive: true,
    },
  });

  return product;
}

describeIntegration("wishlist.service", () => {
  beforeEach(async () => {
    await wipe();
    const user = await db.user.create({
      data: { name: "Joel", email: `${unique("c")}@example.test`, role: "customer" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("adds a product", async () => {
    const product = await makeProduct();
    expect((await addToWishlist(db, userId, product.id)).kind).toBe("ok");

    const items = await listWishlist(db, userId);
    expect(items).toHaveLength(1);
    expect(items[0]?.productId).toBe(product.id);
  });

  it("treats a second click on the heart as one wish", async () => {
    // A 409 here would be a bug the UI has to explain away.
    const product = await makeProduct();
    await addToWishlist(db, userId, product.id);
    expect((await addToWishlist(db, userId, product.id)).kind).toBe("ok");

    expect(await listWishlist(db, userId)).toHaveLength(1);
  });

  it("refuses a product that does not exist", async () => {
    expect((await addToWishlist(db, userId, "nope")).kind).toBe("not_found");
  });

  it("removes a product, and removing it twice is still success", async () => {
    const product = await makeProduct();
    await addToWishlist(db, userId, product.id);

    await removeFromWishlist(db, userId, product.id);
    await removeFromWishlist(db, userId, product.id);

    expect(await listWishlist(db, userId)).toHaveLength(0);
  });

  it("keeps one person's list to themselves", async () => {
    const product = await makeProduct();
    const other = await db.user.create({
      data: { name: "Grace", email: `${unique("o")}@example.test`, role: "customer" },
    });

    await addToWishlist(db, userId, product.id);

    expect(await listWishlist(db, other.id)).toHaveLength(0);
  });

  it("reports stock so the list can offer add-to-cart", async () => {
    const inStock = await makeProduct(5);
    const soldOut = await makeProduct(0);
    await addToWishlist(db, userId, inStock.id);
    await addToWishlist(db, userId, soldOut.id);

    const items = await listWishlist(db, userId);
    expect(items.find((item) => item.productId === inStock.id)?.inStock).toBe(true);
    expect(items.find((item) => item.productId === soldOut.id)?.inStock).toBe(false);
  });

  it("keeps a product that has been pulled from sale, marked unavailable", async () => {
    // Silently vanishing from a saved list looks like the site lost it.
    const product = await makeProduct(5, "draft");
    await addToWishlist(db, userId, product.id);

    const items = await listWishlist(db, userId);
    expect(items).toHaveLength(1);
    expect(items[0]?.available).toBe(false);
  });

  it("shows the member price alongside the regular one", async () => {
    const product = await makeProduct();
    await addToWishlist(db, userId, product.id);

    const items = await listWishlist(db, userId, 10);
    expect(items[0]?.priceCents).toBe(50_000);
    expect(items[0]?.memberPriceCents).toBe(45_000);
  });

  it("newest first, so a fresh save is at the top", async () => {
    const first = await makeProduct();
    const second = await makeProduct();
    await addToWishlist(db, userId, first.id);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await addToWishlist(db, userId, second.id);

    expect((await listWishlist(db, userId))[0]?.productId).toBe(second.id);
  });

  it("hands back a set of ids, for marking hearts on a grid", async () => {
    const product = await makeProduct();
    await addToWishlist(db, userId, product.id);

    const ids = await wishlistProductIds(db, userId);
    expect(ids.has(product.id)).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("goes with the customer when their account is deleted", async () => {
    const product = await makeProduct();
    await addToWishlist(db, userId, product.id);

    await db.user.delete({ where: { id: userId } });

    expect(await db.wishlistItem.count()).toBe(0);
  });
});
