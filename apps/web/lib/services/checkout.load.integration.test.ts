import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addItem, applyCoupon, getOrCreateCart } from "./cart.service";
import { type CheckoutIdentity, startCheckout } from "./checkout.service";
import { availableStock } from "./reservation.service";

/**
 * The P5-04 criterion: 100 concurrent checkouts without stock corruption.
 *
 * The existing concurrency tests stop at ten and each exercises one lock in isolation. This
 * drives the whole checkout path — cart pricing, the coupon claim, the stock reservation, order
 * creation and the order-number sequence — a hundred times at once, which is where locks taken
 * in the wrong order or a sequence that is not actually unique show up.
 *
 * What "without corruption" means here is stated as four separate assertions rather than one
 * summary number, because they fail in different ways:
 *
 *   1. nobody gets stock that does not exist (overselling)
 *   2. nobody loses stock that does exist (lost reservations)
 *   3. the ledger still reconciles — invariant I4
 *   4. no two orders share an order number
 *
 * Slow by design. It is tagged so it can be skipped in a tight loop but still runs in CI.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

/**
 * A pool big enough for the fan-out, or this measures connection queueing rather than lock
 * contention. Prisma's default of ~9 would serialise almost everything.
 *
 * Built with the URL API rather than string concatenation, which silently corrupts a
 * connection string that already carries parameters.
 */
function poolUrl(base: string): string {
  const parsed = new URL(base);
  parsed.searchParams.set("connection_limit", "30");
  parsed.searchParams.set("pool_timeout", "30");
  return parsed.toString();
}

const db = new PrismaClient({
  datasources: { db: { url: url ? poolUrl(url) : "mysql://unused" } },
});

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

async function makeVariant(stock: number, priceCents = 100_000) {
  const product = await db.product.create({
    data: {
      name: unique("Product"),
      slug: unique("product").toLowerCase(),
      status: "active",
      variants: {
        create: {
          sku: unique("SKU").toUpperCase(),
          name: "Default",
          priceCents,
          stockQty: stock,
          weightGrams: 500,
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

/** One shopper: their own cart, one unit, then checkout. */
async function shopper(variantId: string, rateId: string, couponCode?: string) {
  const cartId = await getOrCreateCart(db, { guestToken: unique("g") });
  await addItem(db, cartId, variantId, 1);
  if (couponCode) {
    await applyCoupon(db, cartId, couponCode, { subtotalCents: 100_000 });
  }

  return startCheckout(cartId, GUEST, ADDRESS, rateId, new Date(), db);
}

/**
 * Reconciles stock against the ledger — invariant I4.
 *
 * `opening` is what the variant was created with, because the ledger only records movements
 * since then. Comparing stockQty to itself would be a tautology that passes whatever happens.
 */
async function ledgerBalance(variantId: string, opening: number): Promise<number> {
  const [variant, movements] = await Promise.all([
    db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQty: true },
    }),
    db.inventoryMovement.aggregate({ where: { variantId }, _sum: { delta: true } }),
  ]);

  // Returns the drift: zero means stockQty is exactly what the ledger says it should be.
  return variant.stockQty - (opening + (movements._sum.delta ?? 0));
}

describeIntegration("checkout under load", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("sells exactly the stock that exists across 100 concurrent checkouts", async () => {
    const STOCK = 40;
    const SHOPPERS = 100;

    const variant = await makeVariant(STOCK);
    const rate = await makeZone();

    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: SHOPPERS }, () => shopper(variant.id, rate.id))
    );
    const elapsed = Date.now() - started;

    const won = results.filter((result) => result.kind === "ok");
    const soldOut = results.filter((result) => result.kind === "out_of_stock");
    const other = results.filter(
      (result) => result.kind !== "ok" && result.kind !== "out_of_stock"
    );

    // 1. Nobody got stock that does not exist.
    expect(won.length).toBeLessThanOrEqual(STOCK);
    // 2. Nobody lost stock that does. Together these pin it to exactly STOCK.
    expect(won.length).toBe(STOCK);
    expect(soldOut).toHaveLength(SHOPPERS - STOCK);
    // Every attempt resolved one way or the other — no crashes, no deadlock losses.
    expect(other).toHaveLength(0);

    // 3. Reservations match the winners, one unit each.
    const reserved = await db.stockReservation.aggregate({
      where: { variantId: variant.id, releasedAt: null },
      _sum: { quantity: true },
    });
    expect(reserved._sum.quantity).toBe(STOCK);
    expect(await availableStock(db, variant.id)).toBe(0);

    // 4. Every order got its own number.
    const orders = await db.order.findMany({ select: { orderNo: true } });
    expect(orders).toHaveLength(STOCK);
    expect(new Set(orders.map((order) => order.orderNo)).size).toBe(STOCK);

    // And one line item each — no order was written twice.
    expect(await db.orderItem.count()).toBe(STOCK);

    // Reported so a regression in throughput is visible rather than silent.
    console.warn(
      `[load] ${SHOPPERS} concurrent checkouts on ${STOCK} units in ${elapsed}ms ` +
        `(${won.length} sold, ${soldOut.length} refused)`
    );
  }, 120_000);

  it("holds when the stock is a single unit and a hundred people want it", async () => {
    // The pathological case: maximum contention on one row.
    const variant = await makeVariant(1);
    const rate = await makeZone();

    const results = await Promise.all(
      Array.from({ length: 100 }, () => shopper(variant.id, rate.id))
    );

    expect(results.filter((result) => result.kind === "ok")).toHaveLength(1);
    expect(await db.order.count()).toBe(1);
    expect(await availableStock(db, variant.id)).toBe(0);
  }, 120_000);

  it("does not hand a single-use coupon to more than one of a hundred buyers", async () => {
    /**
     * Two locks in one transaction — the coupon row and the variant row — taken by a hundred
     * transactions at once. This is the shape that deadlocks when the order is inconsistent,
     * which is why checkout claims the coupon before it reserves stock.
     */
    const variant = await makeVariant(100);
    const rate = await makeZone();
    const coupon = await db.coupon.create({
      data: {
        code: unique("ONLYONE").toUpperCase(),
        type: "fixed",
        valueCents: 5_000,
        maxUses: 1,
        maxUsesPerUser: 1,
      },
    });

    const results = await Promise.all(
      Array.from({ length: 100 }, () => shopper(variant.id, rate.id, coupon.code))
    );

    const placed = results.filter((result) => result.kind === "ok");
    // Everyone still gets their order; only the discount is scarce.
    expect(placed).toHaveLength(100);

    const discounted = await db.order.count({ where: { couponCode: coupon.code } });
    expect(discounted).toBe(1);

    const withDiscount = await db.order.count({ where: { discountCents: { gt: 0 } } });
    expect(withDiscount).toBe(1);
  }, 120_000);

  it("keeps stockQty out of the reservation path entirely", async () => {
    /**
     * Invariant I4 in its strictest form: `stockQty` moves only through the ledger.
     *
     * A hundred checkouts reserve stock and none of them is a sale yet, so both the ledger
     * and `stockQty` must be exactly where they started. A reservation that decremented
     * stock directly would pass every other assertion in this file and break this one.
     */
    const variant = await makeVariant(60);
    const rate = await makeZone();

    await Promise.all(Array.from({ length: 100 }, () => shopper(variant.id, rate.id)));

    const after = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQty).toBe(60);
    expect(await db.inventoryMovement.count({ where: { variantId: variant.id } })).toBe(0);
    // Zero drift between stockQty and the ledger.
    expect(await ledgerBalance(variant.id, 60)).toBe(0);
  }, 120_000);
});
