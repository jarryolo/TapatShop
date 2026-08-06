import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";
import { type Cents, orderTotal } from "@/lib/utils/money";

import { priceCart } from "./cart.service";
import { attachToOrder, mirrorToRedis, reserve } from "./reservation.service";
import { quote } from "./shipping.service";

/**
 * Checkout. docs/04 calls POST /checkout/session "the most important endpoint in the system".
 *
 * The rule governing everything here: **nothing the browser sends about money is used.** The
 * request carries an address and a shipping rate id. Prices, discounts, shipping and the
 * total are all recomputed from the database inside the same transaction that reserves stock
 * and writes the order — docs/CLAUDE.md invariant 2.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export interface CheckoutAddress {
  recipient: string;
  phone: string;
  region: string;
  province: string;
  city: string;
  barangay: string;
  street: string;
  postalCode?: string | null;
}

export interface CheckoutIdentity {
  userId?: string | null;
  email: string;
  name: string;
  phone: string;
  isMember: boolean;
  memberPercent: number;
}

/** A difference between what the customer last saw and what is true now. */
export interface CheckoutChange {
  kind: "price_changed" | "stock_reduced" | "unavailable" | "coupon_invalid";
  sku?: string;
  message: string;
}

export interface CheckoutQuote {
  subtotalCents: Cents;
  discountCents: Cents;
  shippingCents: Cents;
  totalCents: Cents;
  couponCode: string | null;
  shippingOptions: Awaited<ReturnType<typeof quote>> extends { kind: "ok"; options: infer O }
    ? O
    : never;
  changes: CheckoutChange[];
}

export type ValidateResult =
  | { kind: "ok"; quote: CheckoutQuote }
  | { kind: "empty_cart" }
  | { kind: "no_service" }
  | { kind: "unavailable_lines"; changes: CheckoutChange[] };

/**
 * Re-prices the cart against the catalog and reports anything that moved.
 *
 * docs/01: a customer must see a price or stock change *before* being asked to pay, never
 * after. This is where they see it, and it deliberately reserves nothing — validating is not
 * committing.
 */
export async function validateCheckout(
  tx: Db,
  cartId: string,
  identity: CheckoutIdentity,
  address: Pick<CheckoutAddress, "region">,
  options: {
    shippingRateId?: string | null;
    /** What the browser last displayed. Used only to detect a change, never as a price. */
    seenSubtotalCents?: number;
  } = {}
): Promise<ValidateResult> {
  const cart = await priceCart(tx, cartId, {
    memberPercent: identity.memberPercent,
    userId: identity.userId,
    isMember: identity.isMember,
  });

  if (cart.lines.length === 0) return { kind: "empty_cart" };

  const changes: CheckoutChange[] = [];
  const blocking: CheckoutChange[] = [];

  for (const line of cart.lines) {
    if (line.issue?.kind === "out_of_stock" || line.issue?.kind === "unavailable") {
      blocking.push({
        kind: "unavailable",
        sku: line.sku,
        message: `${line.productName} (${line.variantName}) is no longer available. Remove it to continue.`,
      });
    } else if (line.issue?.kind === "reduced") {
      changes.push({
        kind: "stock_reduced",
        sku: line.sku,
        message: `Only ${line.issue.available} of ${line.productName} (${line.variantName}) are left, so that is what you will be charged for.`,
      });
    }
  }

  if (blocking.length > 0) return { kind: "unavailable_lines", changes: blocking };

  if (
    typeof options.seenSubtotalCents === "number" &&
    options.seenSubtotalCents !== cart.subtotalCents
  ) {
    changes.push({
      kind: "price_changed",
      message: "Prices have changed since you opened your cart. The new total is shown below.",
    });
  }

  if (cart.couponMessage) {
    changes.push({ kind: "coupon_invalid", message: cart.couponMessage });
  }

  const shipping = await quote(tx, {
    regionCode: address.region,
    subtotalCents: cart.subtotalCents,
    weightGrams: cart.totalWeightGrams,
  });

  if (shipping.kind !== "ok") return { kind: "no_service" };

  const chosen =
    shipping.options.find((option) => option.rateId === options.shippingRateId) ??
    shipping.options[0];

  // A free-shipping coupon zeroes the fee on top of any threshold the rate already has.
  const shippingCents = cart.freeShipping ? 0 : (chosen?.feeCents ?? 0);

  return {
    kind: "ok",
    quote: {
      subtotalCents: cart.subtotalCents,
      discountCents: cart.discountCents,
      shippingCents,
      totalCents: orderTotal({
        subtotalCents: cart.subtotalCents,
        shippingCents,
        discountCents: cart.discountCents,
      }),
      couponCode: cart.couponCode,
      shippingOptions: shipping.options as CheckoutQuote["shippingOptions"],
      changes,
    },
  };
}

export type StartCheckoutResult =
  | { kind: "ok"; orderId: string; orderNo: string; totalCents: Cents }
  | { kind: "empty_cart" }
  | { kind: "unavailable_lines"; changes: CheckoutChange[] }
  | { kind: "no_service" }
  | { kind: "out_of_stock"; changes: CheckoutChange[] };

/**
 * The next order number: TS-2026-000123.
 *
 * Derived from the highest existing number for the year rather than a row count, so deleting
 * a row cannot cause a collision. It runs inside the checkout transaction, after the
 * reservation locks are held.
 */
export async function nextOrderNo(tx: Db, year: number): Promise<string> {
  const prefix = `TS-${year}-`;
  const latest = await tx.order.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });

  const lastSequence = latest ? Number(latest.orderNo.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSequence + 1).padStart(6, "0")}`;
}

/**
 * Reserves stock and creates the order, in one transaction.
 *
 * The sequence is the one docs/06 specifies, and the order matters:
 *   1. re-price the whole cart from the database
 *   2. reserve stock with row locks — the last-unit race is settled here
 *   3. create the order and its snapshot line items
 *   4. commit
 *
 * PayMongo is called by the *caller*, after this commits, and releases the reservation if
 * that call fails. Doing it inside would hold row locks across a network request to a third
 * party — one slow response from PayMongo would then block every other buyer of those items.
 */
export async function startCheckout(
  cartId: string,
  identity: CheckoutIdentity,
  address: CheckoutAddress,
  shippingRateId: string | null,
  now: Date = new Date(),
  /**
   * The client to run on. Defaults to the app singleton.
   *
   * Every other service takes one; this one owns its transaction, so it takes the client
   * rather than a tx. Without this the function is untestable — it would always write to
   * whatever DATABASE_URL points at, not the test database.
   */
  client: PrismaClient = db
): Promise<StartCheckoutResult> {
  const result = await client.$transaction(
    async (tx) => {
      const validation = await validateCheckout(tx, cartId, identity, address, { shippingRateId });

      if (validation.kind === "empty_cart") return { kind: "empty_cart" } as const;
      if (validation.kind === "no_service") return { kind: "no_service" } as const;
      if (validation.kind === "unavailable_lines") {
        return { kind: "unavailable_lines", changes: validation.changes } as const;
      }

      const cart = await priceCart(tx, cartId, {
        memberPercent: identity.memberPercent,
        userId: identity.userId,
        isMember: identity.isMember,
      });

      // Reserve only what is actually being charged for.
      const sellable = cart.lines.filter((line) => line.effectiveQuantity > 0);

      const reservation = await reserve(
        tx as Prisma.TransactionClient,
        cartId,
        sellable.map((line) => ({ variantId: line.variantId, quantity: line.effectiveQuantity })),
        now
      );

      if (reservation.kind === "insufficient") {
        // Someone else took it between the cart page and here. Surfaced before payment.
        return {
          kind: "out_of_stock",
          changes: reservation.shortfalls.map((shortfall) => {
            const line = sellable.find((l) => l.variantId === shortfall.variantId);
            return {
              kind: "stock_reduced" as const,
              sku: line?.sku,
              message: line
                ? `${line.productName} (${line.variantName}) only has ${shortfall.available} left.`
                : `Only ${shortfall.available} left of one of your items.`,
            };
          }),
        } as const;
      }

      const { subtotalCents, discountCents, shippingCents, totalCents } = validation.quote;

      const order = await tx.order.create({
        data: {
          orderNo: await nextOrderNo(tx, now.getUTCFullYear()),
          userId: identity.userId ?? null,
          guestEmail: identity.userId ? null : identity.email,
          status: "pending",
          paymentStatus: "awaiting_payment",
          fulfillmentStatus: "unfulfilled",
          subtotalCents,
          shippingCents,
          discountCents,
          totalCents,
          couponCode: validation.quote.couponCode,
          // Frozen copy. If the customer later edits their address book, this order still
          // shows where it actually went — docs/03 decision 5.
          shippingAddress: { ...address },
          customerName: identity.name,
          customerEmail: identity.email,
          customerPhone: identity.phone,
          shippingMethod: null,
          placedAt: now,
          createdAt: now,
          items: {
            create: sellable.map((line) => ({
              variantId: line.variantId,
              // Snapshots — never joined back to live product data. docs/03 decision 4.
              productName: line.productName,
              variantName: line.variantName,
              sku: line.sku,
              imageUrl: line.imageUrl,
              unitPriceCents: line.unitPriceCents,
              quantity: line.effectiveQuantity,
              lineTotalCents: line.lineTotalCents,
            })),
          },
          events: {
            create: {
              type: "order_placed",
              message: "Order placed, waiting for payment.",
              isPublic: true,
              createdAt: now,
            },
          },
        },
        select: { id: true, orderNo: true, totalCents: true },
      });

      await attachToOrder(tx, reservation.reservationIds, order.id);

      return {
        kind: "ok",
        orderId: order.id,
        orderNo: order.orderNo,
        totalCents: order.totalCents,
        reservedLines: sellable.map((line) => ({
          variantId: line.variantId,
          quantity: line.effectiveQuantity,
        })),
      } as const;
    },
    { timeout: 20_000, maxWait: 15_000 }
  );

  if (result.kind === "ok") {
    // After the commit, never inside it — see reservation.service.
    await mirrorToRedis(cartId, result.reservedLines);
    return {
      kind: "ok",
      orderId: result.orderId,
      orderNo: result.orderNo,
      totalCents: result.totalCents,
    };
  }

  return result;
}

export const checkoutService = {
  validate: (
    cartId: string,
    identity: CheckoutIdentity,
    address: Pick<CheckoutAddress, "region">,
    options?: { shippingRateId?: string | null; seenSubtotalCents?: number }
  ) => validateCheckout(db, cartId, identity, address, options),
  start: startCheckout,
};
