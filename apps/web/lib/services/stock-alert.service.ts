import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";

import { sendEmail } from "./email.service";

/**
 * "Tell me when this is back."
 *
 * The firing rule is a **crossing**, not a level: notifications go out when a variant goes
 * from having nothing available to having something. Checking "stock > 0" after every movement
 * would email everyone again on the second delivery of the week, and checking it on a schedule
 * would email them for stock that a faster buyer has already taken.
 *
 * Availability, not `stockQty` — a unit held by someone's checkout is not back in stock for
 * anyone else, and telling fifty people to hurry for one reserved unit is how a shop earns a
 * reputation for lying.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export type SubscribeResult = { kind: "ok" } | { kind: "not_found" } | { kind: "in_stock" };

/**
 * Registers interest. Idempotent per address per variant.
 *
 * Refuses when the thing is already available, because the only honest answer then is "it is
 * in stock, go and buy it" — and a subscription that can never fire is a promise we silently
 * fail to keep.
 */
export async function subscribeToStock(
  tx: Db,
  variantId: string,
  email: string,
  userId: string | null,
  now: Date = new Date()
): Promise<SubscribeResult> {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, isActive: true },
  });
  if (!variant?.isActive) return { kind: "not_found" };

  if ((await availableQty(tx, variantId, now)) > 0) return { kind: "in_stock" };

  const address = email.trim().toLowerCase();

  await tx.stockSubscription.upsert({
    where: { variantId_email: { variantId, email: address } },
    create: { variantId, email: address, userId },
    // Asking again after being notified puts them back in the queue; asking twice while
    // already waiting changes nothing.
    update: { notifiedAt: null, userId },
  });

  return { kind: "ok" };
}

export async function unsubscribeFromStock(
  tx: Db,
  variantId: string,
  email: string
): Promise<void> {
  await tx.stockSubscription.deleteMany({
    where: { variantId, email: email.trim().toLowerCase() },
  });
}

/**
 * Stock on hand minus what live checkouts are holding.
 *
 * Mirrors reservation.service's definition. Duplicated as a small query rather than imported
 * because importing would make the inventory path depend on the reservation path in the
 * opposite direction to the one it already depends on.
 */
async function availableQty(tx: Db, variantId: string, now: Date): Promise<number> {
  const [variant, held] = await Promise.all([
    tx.productVariant.findUnique({ where: { id: variantId }, select: { stockQty: true } }),
    tx.stockReservation.aggregate({
      where: { variantId, releasedAt: null, expiresAt: { gt: now } },
      _sum: { quantity: true },
    }),
  ]);

  return Math.max(0, (variant?.stockQty ?? 0) - (held._sum.quantity ?? 0));
}

export interface PendingAlert {
  subscriptionId: string;
  email: string;
  userId: string | null;
  productName: string;
  variantName: string;
  slug: string;
}

/**
 * Claims everyone waiting on a variant, inside the caller's transaction.
 *
 * Stamps `notifiedAt` as part of claiming rather than after sending, so two concurrent
 * restocks cannot both pick up the same subscriber. The cost of that ordering is that a send
 * which then fails is not retried — the right trade for a marketing email, and the wrong one
 * for a receipt.
 *
 * Returns the recipients instead of emailing them. Sending inside the transaction would hold
 * row locks across a network call, which is the same mistake checkout deliberately avoids
 * with PayMongo.
 */
export async function claimAlertsFor(
  tx: Db,
  variantId: string,
  now: Date = new Date()
): Promise<PendingAlert[]> {
  /**
   * Raw SQL, justified per docs/03: Prisma cannot express SELECT ... FOR UPDATE, and without
   * the lock this read-then-stamp is a race. Two restocks landing together both read the same
   * waiting rows, both stamp them, and both return the same addresses — so the customer who
   * asked once gets told twice. Locking the variant serialises every claim against it.
   */
  await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${variantId} FOR UPDATE`;

  const waiting = await tx.stockSubscription.findMany({
    where: { variantId, notifiedAt: null },
    select: { id: true, email: true, userId: true },
  });

  if (waiting.length === 0) return [];

  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { name: true, product: { select: { name: true, slug: true, status: true } } },
  });

  // A product pulled from sale is not something to drive traffic to.
  if (!variant || variant.product.status !== "active") return [];

  await tx.stockSubscription.updateMany({
    where: { id: { in: waiting.map((row) => row.id) } },
    data: { notifiedAt: now },
  });

  // The in-app bell, written in the same transaction as the claim so the two agree.
  const withAccounts = waiting.filter((row) => row.userId !== null);
  if (withAccounts.length > 0) {
    await tx.notification.createMany({
      data: withAccounts.map((row) => ({
        userId: row.userId as string,
        type: "back_in_stock",
        title: `${variant.product.name} is back`,
        body: `${variant.name} is available again.`,
        linkUrl: `/products/${variant.product.slug}`,
      })),
    });
  }

  return waiting.map((row) => ({
    subscriptionId: row.id,
    email: row.email,
    userId: row.userId,
    productName: variant.product.name,
    variantName: variant.name,
    slug: variant.product.slug,
  }));
}

/** Sends what `claimAlertsFor` handed back. Call after the transaction commits, never inside. */
export async function sendAlerts(alerts: PendingAlert[]): Promise<number> {
  for (const alert of alerts) {
    await sendEmail({
      to: alert.email,
      template: "back-in-stock",
      data: {
        productName: alert.productName,
        variantName: alert.variantName,
        url: `/products/${alert.slug}`,
      },
    });
  }

  return alerts.length;
}

export function countWaiting(tx: Db, variantId: string) {
  return tx.stockSubscription.count({ where: { variantId, notifiedAt: null } });
}

export const stockAlertService = {
  subscribe: (variantId: string, email: string, userId: string | null) =>
    db.$transaction((tx) => subscribeToStock(tx, variantId, email, userId)),
  unsubscribe: (variantId: string, email: string) =>
    db.$transaction((tx) => unsubscribeFromStock(tx, variantId, email)),
  waiting: (variantId: string) => countWaiting(db, variantId),
};
