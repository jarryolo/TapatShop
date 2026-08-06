import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";
import { type Cents, lineTotal, memberUnitPrice, sumCents } from "@/lib/utils/money";

/**
 * The cart. See docs/03 for the guest-cart rules and docs/CLAUDE.md for the money rules.
 *
 * The rule that shapes everything here: **the cart stores variant ids and quantities, and
 * nothing else.** No prices, no totals, no names. Every read reprices from the database, so
 * a price change, a stock change, or a member being verified is reflected the next time the
 * customer looks — and there is no stored total for a client to tamper with.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** docs/03: the guest token cookie has a 30-day expiry. */
export const CART_TTL_DAYS = 30;

export function cartExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ─────────────────────────────  identity  ─────────────────────────────

export interface CartIdentity {
  userId?: string | null;
  guestToken?: string | null;
}

/**
 * Finds or creates the caller's cart.
 *
 * A signed-in customer always uses their user cart, even if a guest cookie is still present —
 * merging is an explicit step at login, not something that happens implicitly on every read.
 */
export async function getOrCreateCart(tx: Db, identity: CartIdentity): Promise<string> {
  if (identity.userId) {
    const existing = await tx.cart.findFirst({
      where: { userId: identity.userId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing.id;

    const created = await tx.cart.create({
      data: { userId: identity.userId, expiresAt: cartExpiry() },
      select: { id: true },
    });
    return created.id;
  }

  if (identity.guestToken) {
    const existing = await tx.cart.findUnique({
      where: { guestToken: identity.guestToken },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await tx.cart.create({
      data: { guestToken: identity.guestToken, expiresAt: cartExpiry() },
      select: { id: true },
    });
    return created.id;
  }

  throw new Error("getOrCreateCart needs either a userId or a guestToken");
}

export async function findCartId(tx: Db, identity: CartIdentity): Promise<string | null> {
  if (identity.userId) {
    const cart = await tx.cart.findFirst({
      where: { userId: identity.userId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (cart) return cart.id;
  }

  if (identity.guestToken) {
    const cart = await tx.cart.findUnique({
      where: { guestToken: identity.guestToken },
      select: { id: true },
    });
    if (cart) return cart.id;
  }

  return null;
}

// ─────────────────────────────  pricing  ─────────────────────────────

/** What is wrong with a line, if anything. The cart page shows these verbatim. */
export type LineIssue =
  | { kind: "out_of_stock" }
  | { kind: "reduced"; available: number; requested: number }
  | { kind: "unavailable" };

export interface PricedLine {
  id: string;
  variantId: string;
  productName: string;
  productSlug: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  unitPriceCents: Cents;
  /** The list price, when a member discount is being applied. */
  listPriceCents: Cents | null;
  quantity: number;
  lineTotalCents: Cents;
  stockQty: number;
  issue: LineIssue | null;
}

export interface PricedCart {
  cartId: string | null;
  lines: PricedLine[];
  subtotalCents: Cents;
  itemCount: number;
  /** True when anything changed under the customer since they added it. */
  hasIssues: boolean;
}

export const EMPTY_CART: PricedCart = {
  cartId: null,
  lines: [],
  subtotalCents: 0,
  itemCount: 0,
  hasIssues: false,
};

/**
 * Prices the cart from scratch. The only way a total is ever produced.
 *
 * Nothing here trusts a stored figure — docs/CLAUDE.md invariant 2 is that checkout
 * recomputes every line from the database, and the cart is the same rule one step earlier so
 * the number the customer sees at checkout is the one they saw in the drawer.
 *
 * An out-of-stock or deleted line is reported, not silently dropped. A cart that quietly
 * loses items is worse than one that explains itself.
 */
export async function priceCart(
  tx: Db,
  cartId: string | null,
  memberPercent = 0
): Promise<PricedCart> {
  if (!cartId) return EMPTY_CART;

  const items = await tx.cartItem.findMany({
    where: { cartId },
    orderBy: { addedAt: "asc" },
    select: {
      id: true,
      quantity: true,
      variantId: true,
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          priceCents: true,
          stockQty: true,
          isActive: true,
          product: {
            select: {
              name: true,
              slug: true,
              status: true,
              images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
            },
          },
        },
      },
    },
  });

  const lines: PricedLine[] = items.map((item) => {
    const variant = item.variant;
    const sellable = variant.isActive && variant.product.status === "active";

    const listPrice = variant.priceCents;
    const unitPrice = memberPercent > 0 ? memberUnitPrice(listPrice, memberPercent) : listPrice;

    let issue: LineIssue | null = null;
    let effectiveQuantity = item.quantity;

    if (!sellable) {
      issue = { kind: "unavailable" };
      effectiveQuantity = 0;
    } else if (variant.stockQty === 0) {
      issue = { kind: "out_of_stock" };
      effectiveQuantity = 0;
    } else if (item.quantity > variant.stockQty) {
      // The line is priced at what can actually be bought, so the subtotal is never a
      // promise the warehouse cannot keep.
      issue = { kind: "reduced", available: variant.stockQty, requested: item.quantity };
      effectiveQuantity = variant.stockQty;
    }

    return {
      id: item.id,
      variantId: variant.id,
      productName: variant.product.name,
      productSlug: variant.product.slug,
      variantName: variant.name,
      sku: variant.sku,
      imageUrl: variant.product.images[0]?.url ?? null,
      unitPriceCents: unitPrice,
      listPriceCents: memberPercent > 0 && unitPrice !== listPrice ? listPrice : null,
      quantity: item.quantity,
      lineTotalCents: lineTotal(unitPrice, effectiveQuantity),
      stockQty: variant.stockQty,
      issue,
    };
  });

  return {
    cartId,
    lines,
    subtotalCents: sumCents(lines.map((line) => line.lineTotalCents)),
    itemCount: lines.reduce((sum, line) => sum + (line.issue ? 0 : line.quantity), 0),
    hasIssues: lines.some((line) => line.issue !== null),
  };
}

// ─────────────────────────────  mutations  ─────────────────────────────

export type AddResult =
  | { kind: "ok"; quantity: number; clamped: boolean; available: number }
  | { kind: "unavailable" }
  | { kind: "out_of_stock" };

/**
 * Adds to the cart, or tops up the line that is already there.
 *
 * Quantities are clamped to available stock rather than rejected: someone asking for 10 of
 * the last 3 wants 3, and telling them so is more useful than refusing the whole action. The
 * caller reports the clamp — silently giving them fewer is how people end up surprised at
 * checkout.
 */
export async function addItem(
  tx: Db,
  cartId: string,
  variantId: string,
  quantity: number
): Promise<AddResult> {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { stockQty: true, isActive: true, product: { select: { status: true } } },
  });

  if (!variant || !variant.isActive || variant.product.status !== "active") {
    return { kind: "unavailable" };
  }
  if (variant.stockQty === 0) return { kind: "out_of_stock" };

  const existing = await tx.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
    select: { id: true, quantity: true },
  });

  const requested = (existing?.quantity ?? 0) + Math.max(1, quantity);
  const finalQuantity = Math.min(requested, variant.stockQty);

  if (existing) {
    await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: finalQuantity } });
  } else {
    await tx.cartItem.create({ data: { cartId, variantId, quantity: finalQuantity } });
  }

  await touchCart(tx, cartId);

  return {
    kind: "ok",
    quantity: finalQuantity,
    clamped: finalQuantity < requested,
    available: variant.stockQty,
  };
}

export type UpdateResult =
  | { kind: "ok"; quantity: number; clamped: boolean; available: number }
  | { kind: "removed" }
  | { kind: "not_found" };

/** Sets a line's quantity. Zero removes it — docs/04. */
export async function updateItemQuantity(
  tx: Db,
  cartId: string,
  itemId: string,
  quantity: number
): Promise<UpdateResult> {
  const item = await tx.cartItem.findFirst({
    where: { id: itemId, cartId },
    select: { id: true, variant: { select: { stockQty: true } } },
  });
  if (!item) return { kind: "not_found" };

  if (quantity <= 0) {
    await tx.cartItem.delete({ where: { id: item.id } });
    await touchCart(tx, cartId);
    return { kind: "removed" };
  }

  const available = item.variant.stockQty;
  const finalQuantity = Math.min(quantity, Math.max(0, available));

  if (finalQuantity === 0) {
    await tx.cartItem.delete({ where: { id: item.id } });
    await touchCart(tx, cartId);
    return { kind: "removed" };
  }

  await tx.cartItem.update({ where: { id: item.id }, data: { quantity: finalQuantity } });
  await touchCart(tx, cartId);

  return { kind: "ok", quantity: finalQuantity, clamped: finalQuantity < quantity, available };
}

export async function removeItem(tx: Db, cartId: string, itemId: string): Promise<boolean> {
  const deleted = await tx.cartItem.deleteMany({ where: { id: itemId, cartId } });
  if (deleted.count > 0) await touchCart(tx, cartId);
  return deleted.count > 0;
}

/** Pushes the expiry out. An actively used cart should not expire mid-shop. */
async function touchCart(tx: Db, cartId: string): Promise<void> {
  await tx.cart.update({ where: { id: cartId }, data: { expiresAt: cartExpiry() } });
}

// ─────────────────────────────  merge  ─────────────────────────────

export interface MergeSummary {
  merged: number;
  clamped: number;
}

/**
 * Folds a guest cart into the user's cart at sign-in.
 *
 * docs/03 calls this out as where duplicate-line bugs hide, and the schema's unique
 * constraint on (cartId, variantId) means a naive copy throws rather than duplicating. So
 * matching variants have their quantities summed, each result is clamped to available stock,
 * and the guest cart is deleted.
 *
 * Runs in one transaction: a half-merged cart that has been emptied on the guest side and not
 * filled on the user side loses the customer's basket.
 */
export async function mergeGuestCart(
  tx: Db,
  guestToken: string,
  userId: string
): Promise<MergeSummary> {
  const guestCart = await tx.cart.findUnique({
    where: { guestToken },
    select: { id: true, items: { select: { variantId: true, quantity: true } } },
  });

  if (!guestCart || guestCart.items.length === 0) {
    if (guestCart) await tx.cart.delete({ where: { id: guestCart.id } });
    return { merged: 0, clamped: 0 };
  }

  const userCartId = await getOrCreateCart(tx, { userId });

  const existing = await tx.cartItem.findMany({
    where: { cartId: userCartId },
    select: { id: true, variantId: true, quantity: true },
  });
  const existingByVariant = new Map(existing.map((item) => [item.variantId, item]));

  const stocks = await tx.productVariant.findMany({
    where: { id: { in: guestCart.items.map((item) => item.variantId) } },
    select: { id: true, stockQty: true, isActive: true },
  });
  const stockById = new Map(stocks.map((variant) => [variant.id, variant]));

  let merged = 0;
  let clamped = 0;

  for (const item of guestCart.items) {
    const variant = stockById.get(item.variantId);
    // Skip anything that stopped being sellable while the cart sat in a cookie.
    if (!variant || !variant.isActive || variant.stockQty === 0) continue;

    const already = existingByVariant.get(item.variantId);
    const summed = (already?.quantity ?? 0) + item.quantity;
    const finalQuantity = Math.min(summed, variant.stockQty);
    if (finalQuantity < summed) clamped += 1;

    if (already) {
      await tx.cartItem.update({ where: { id: already.id }, data: { quantity: finalQuantity } });
    } else {
      await tx.cartItem.create({
        data: { cartId: userCartId, variantId: item.variantId, quantity: finalQuantity },
      });
    }
    merged += 1;
  }

  // Deleting the cart cascades its items.
  await tx.cart.delete({ where: { id: guestCart.id } });
  await touchCart(tx, userCartId);

  return { merged, clamped };
}

/** Bound helpers for callers that do not compose their own transaction. */
export const cartService = {
  price: (cartId: string | null, memberPercent = 0) => priceCart(db, cartId, memberPercent),
  getOrCreate: (identity: CartIdentity) => db.$transaction((tx) => getOrCreateCart(tx, identity)),
  find: (identity: CartIdentity) => findCartId(db, identity),
  add: (cartId: string, variantId: string, quantity: number) =>
    db.$transaction((tx) => addItem(tx, cartId, variantId, quantity)),
  update: (cartId: string, itemId: string, quantity: number) =>
    db.$transaction((tx) => updateItemQuantity(tx, cartId, itemId, quantity)),
  remove: (cartId: string, itemId: string) =>
    db.$transaction((tx) => removeItem(tx, cartId, itemId)),
  merge: (guestToken: string, userId: string) =>
    db.$transaction((tx) => mergeGuestCart(tx, guestToken, userId)),
};
