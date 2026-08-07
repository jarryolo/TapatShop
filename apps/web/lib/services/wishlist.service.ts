import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";
import { type Cents, memberUnitPrice } from "@/lib/utils/money";

/**
 * The wishlist. Signed-in customers only — docs/01 lists it as a Customer capability.
 *
 * Deliberately not mirrored into a cookie for guests. A wishlist is a long-lived list people
 * expect to still be there next month, and a cookie-backed one silently empties when the
 * browser clears storage, which is worse than never having offered it.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export async function listWishlist(tx: Db, userId: string, memberPercent = 0) {
  const items = await tx.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true } },
          variants: {
            where: { isActive: true },
            select: { id: true, priceCents: true, stockQty: true },
            orderBy: { priceCents: "asc" },
          },
        },
      },
    },
  });

  return items.map((item) => {
    const cheapest = item.product.variants[0];
    const inStock = item.product.variants.some((variant) => variant.stockQty > 0);

    return {
      id: item.id,
      addedAt: item.createdAt,
      productId: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
      imageUrl: item.product.images[0]?.url ?? null,
      imageAlt: item.product.images[0]?.alt ?? item.product.name,
      priceCents: (cheapest?.priceCents ?? 0) as Cents,
      memberPriceCents: memberUnitPrice((cheapest?.priceCents ?? 0) as Cents, memberPercent),
      inStock,
      /** A product pulled from sale still shows, greyed — silently vanishing looks like a bug. */
      available: item.product.status === "active",
      firstVariantId: cheapest?.id ?? null,
    };
  });
}

export type AddResult = { kind: "ok" } | { kind: "not_found" };

/**
 * Adds a product, idempotently.
 *
 * Clicking the heart twice is one wish, not an error — the unique index makes the second call
 * a no-op rather than a 409 the UI would have to explain.
 */
export async function addToWishlist(tx: Db, userId: string, productId: string): Promise<AddResult> {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return { kind: "not_found" };

  await tx.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });

  return { kind: "ok" };
}

/** Removing something that is not there is success, for the same reason. */
export async function removeFromWishlist(tx: Db, userId: string, productId: string): Promise<void> {
  await tx.wishlistItem.deleteMany({ where: { userId, productId } });
}

export async function wishlistProductIds(tx: Db, userId: string): Promise<Set<string>> {
  const items = await tx.wishlistItem.findMany({ where: { userId }, select: { productId: true } });
  return new Set(items.map((item) => item.productId));
}

export const wishlistService = {
  list: (userId: string, memberPercent?: number) => listWishlist(db, userId, memberPercent),
  add: (userId: string, productId: string) => addToWishlist(db, userId, productId),
  remove: (userId: string, productId: string) => removeFromWishlist(db, userId, productId),
  ids: (userId: string) => wishlistProductIds(db, userId),
};
