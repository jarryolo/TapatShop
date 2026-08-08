import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

/**
 * Stock reservations. See docs/03-data-model.md.
 *
 * docs/03 calls the last-unit race "the most likely production bug in this system", so the
 * design here is deliberately conservative:
 *
 *   - stock is NOT decremented at checkout, only reserved. The decrement happens on the paid
 *     webhook, through the inventory ledger, because until PayMongo says paid there is no
 *     sale to record.
 *   - availability is `stockQty - active reservations`, computed in SQL, never cached.
 *   - the reserving transaction takes a row lock on the variant with SELECT ... FOR UPDATE,
 *     which is what makes two simultaneous buyers of the last unit resolve to exactly one.
 *
 * Redis mirrors each reservation with a TTL. That is the fast expiry path, not the source of
 * truth: `activeWhere` below filters on expiresAt, so an expired reservation stops blocking
 * stock even if Redis and the sweeper have both failed.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** docs/03 and .env.example: reservations live 900 seconds. */
export const RESERVATION_TTL_SECONDS = 900;

export function reservationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESERVATION_TTL_SECONDS * 1000);
}

/** Not released, and not yet expired. The only definition of "still holding stock". */
function activeWhere(now: Date): Prisma.StockReservationWhereInput {
  return { releasedAt: null, expiresAt: { gt: now } };
}

export function reservationKey(variantId: string, cartId: string): string {
  return `resv:${variantId}:${cartId}`;
}

// ─────────────────────────────  availability  ─────────────────────────────

/**
 * How many units can still be sold: on-hand minus everything currently held.
 *
 * Invariant I5. Note this is NOT the same as `stockQty` — a variant with 3 on hand and 3
 * reserved is unbuyable, and the product page showing "3 left" while checkout refuses is
 * the confusing case this prevents.
 */
export async function availableStock(tx: Db, variantId: string, now = new Date()): Promise<number> {
  const [variant, held] = await Promise.all([
    tx.productVariant.findUnique({ where: { id: variantId }, select: { stockQty: true } }),
    tx.stockReservation.aggregate({
      where: { variantId, ...activeWhere(now) },
      _sum: { quantity: true },
    }),
  ]);

  if (!variant) return 0;
  return Math.max(0, variant.stockQty - (held._sum.quantity ?? 0));
}

/** Availability for several variants at once, without a query per variant. */
export async function availableStockMany(
  tx: Db,
  variantIds: string[],
  now = new Date()
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();

  const [variants, held] = await Promise.all([
    tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, stockQty: true },
    }),
    tx.stockReservation.groupBy({
      by: ["variantId"],
      where: { variantId: { in: variantIds }, ...activeWhere(now) },
      _sum: { quantity: true },
    }),
  ]);

  const heldBy = new Map(held.map((row) => [row.variantId, row._sum.quantity ?? 0]));

  return new Map(
    variants.map((variant) => [
      variant.id,
      Math.max(0, variant.stockQty - (heldBy.get(variant.id) ?? 0)),
    ])
  );
}

/**
 * The same figure as `availableStockMany`, read so that it is actually current.
 *
 * Only for use inside a transaction that already holds `FOR UPDATE` on these variants — the
 * reserving path. Everywhere else (catalogue, product page, admin) a snapshot read is right:
 * it is cheaper, it takes no locks, and a stock figure on a listing page is a display value
 * that was going to be a moment stale anyway.
 */
export async function availableStockLocking(
  tx: Prisma.TransactionClient,
  variantIds: string[],
  now = new Date()
): Promise<Map<string, number>> {
  const available = new Map<string, number>();

  for (const variantId of variantIds) {
    const [stock] = await tx.$queryRaw<{ stockQty: number }[]>`
      SELECT stockQty FROM product_variants WHERE id = ${variantId} FOR UPDATE`;

    const [held] = await tx.$queryRaw<{ held: bigint | number | null }[]>`
      SELECT COALESCE(SUM(quantity), 0) AS held
      FROM stock_reservations
      WHERE variantId = ${variantId}
        AND releasedAt IS NULL
        AND expiresAt > ${now}
      FOR UPDATE`;

    available.set(variantId, Math.max(0, (stock?.stockQty ?? 0) - Number(held?.held ?? 0)));
  }

  return available;
}

// ─────────────────────────────  reserving  ─────────────────────────────

export interface ReservationLine {
  variantId: string;
  quantity: number;
}

export interface ReservationShortfall {
  variantId: string;
  requested: number;
  available: number;
}

export type ReserveResult =
  | { kind: "ok"; reservationIds: string[]; expiresAt: Date }
  | { kind: "insufficient"; shortfalls: ReservationShortfall[] };

/**
 * Reserves every line, or none of them.
 *
 * Must be called inside a transaction — it takes row locks that have to be held until the
 * order is written. Partial reservation is not offered: a basket that half-reserves leaves
 * the customer holding stock for items they were never told they could not complete.
 *
 * Variants are locked in a fixed order (sorted by id). Two carts containing the same two
 * variants in opposite orders would otherwise take the locks in opposite orders and deadlock,
 * which surfaces as an intermittent checkout failure under exactly the load you least want it.
 */
export async function reserve(
  tx: Prisma.TransactionClient,
  cartId: string,
  lines: ReservationLine[],
  now = new Date()
): Promise<ReserveResult> {
  if (lines.length === 0)
    return { kind: "ok", reservationIds: [], expiresAt: reservationExpiry(now) };

  const ordered = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));

  /**
   * Raw SQL, justified per docs/03: Prisma has no way to express SELECT ... FOR UPDATE, and
   * without the row lock two concurrent transactions both read the same stockQty, both
   * decide there is enough, and both reserve the last unit.
   *
   * Locking every variant up front — before checking anything — means the whole basket is
   * serialised against other buyers of the same items for the rest of this transaction.
   */
  for (const line of ordered) {
    await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${line.variantId} FOR UPDATE`;
  }

  /**
   * Availability, read with locking reads — not `availableStockMany`.
   *
   * This is the difference between the lock working and only appearing to. MySQL's default
   * isolation is REPEATABLE READ, where a *plain* SELECT returns the transaction's snapshot,
   * taken at its first read. In checkout that first read is `validateCheckout`, long before
   * the FOR UPDATE above — so a plain read here reports the stock and reservations as they
   * were before any concurrent buyer committed, and every one of them is told there is stock.
   *
   * P5-04's load test caught it: 100 buyers, one unit, and thirty of them got past this check.
   * Nothing oversold only because they then collided on the order number and rolled back.
   *
   * A locking read is what forces the latest committed rows to be seen. The `FOR UPDATE` on
   * stock_reservations also gap-locks the range, so a concurrent INSERT of a new reservation
   * blocks rather than slipping in behind this count.
   */
  const available = await availableStockLocking(
    tx,
    ordered.map((line) => line.variantId),
    now
  );

  const shortfalls: ReservationShortfall[] = [];
  for (const line of ordered) {
    const canHave = available.get(line.variantId) ?? 0;
    if (line.quantity > canHave) {
      shortfalls.push({ variantId: line.variantId, requested: line.quantity, available: canHave });
    }
  }

  // Returning before writing anything leaves the locks to be released by the rollback.
  if (shortfalls.length > 0) return { kind: "insufficient", shortfalls };

  const expiresAt = reservationExpiry(now);
  const reservationIds: string[] = [];

  for (const line of ordered) {
    const created = await tx.stockReservation.create({
      data: { variantId: line.variantId, quantity: line.quantity, expiresAt },
      select: { id: true },
    });
    reservationIds.push(created.id);
  }

  return { kind: "ok", reservationIds, expiresAt };
}

/**
 * Mirrors reservations into Redis with a TTL.
 *
 * Called after the transaction commits, never inside it. A Redis write inside the
 * transaction would leave a key pointing at a reservation that rolled back — and since the
 * database is the source of truth, a missing key is harmless while a phantom one is not.
 *
 * Failures are swallowed: Redis being down must not fail a checkout, because `activeWhere`
 * already expires reservations without it.
 */
export async function mirrorToRedis(
  cartId: string,
  lines: ReservationLine[],
  ttlSeconds = RESERVATION_TTL_SECONDS
): Promise<void> {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();

    const pipeline = redis.pipeline();
    for (const line of lines) {
      pipeline.set(reservationKey(line.variantId, cartId), String(line.quantity), "EX", ttlSeconds);
    }
    await pipeline.exec();
  } catch {
    // The durable row is what counts. See the doc comment.
  }
}

async function forgetInRedis(cartId: string, variantIds: string[]): Promise<void> {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    if (variantIds.length === 0) return;
    await redis.del(...variantIds.map((variantId) => reservationKey(variantId, cartId)));
  } catch {
    // Same reasoning: the key expires on its own.
  }
}

// ─────────────────────────────  releasing and consuming  ─────────────────────────────

/** Releases specific reservations. Idempotent — releasing twice is not an error. */
export async function releaseReservations(
  tx: Db,
  reservationIds: string[],
  now = new Date()
): Promise<number> {
  if (reservationIds.length === 0) return 0;

  const result = await tx.stockReservation.updateMany({
    where: { id: { in: reservationIds }, releasedAt: null },
    data: { releasedAt: now },
  });

  return result.count;
}

/** Releases everything held for an order — payment failed, or the customer walked away. */
export async function releaseForOrder(tx: Db, orderId: string, now = new Date()): Promise<number> {
  const result = await tx.stockReservation.updateMany({
    where: { orderId, releasedAt: null },
    data: { releasedAt: now },
  });
  return result.count;
}

/** Attaches reservations to an order once it exists, so the webhook can find them later. */
export async function attachToOrder(
  tx: Db,
  reservationIds: string[],
  orderId: string
): Promise<void> {
  if (reservationIds.length === 0) return;
  await tx.stockReservation.updateMany({
    where: { id: { in: reservationIds } },
    data: { orderId },
  });
}

// ─────────────────────────────  the sweeper  ─────────────────────────────

export interface SweepResult {
  released: number;
}

/**
 * Marks expired reservations released.
 *
 * Redis TTL is the fast path; this is the durable one, for the rows Redis lost — a restart,
 * an eviction, a network partition during the write. It is deliberately not the mechanism
 * that makes stock available again: `activeWhere` already ignores anything past its expiry,
 * so a sweeper that never runs costs table size and clarity, not correctness.
 */
export async function sweepExpiredReservations(tx: Db, now = new Date()): Promise<SweepResult> {
  const result = await tx.stockReservation.updateMany({
    where: { releasedAt: null, expiresAt: { lte: now } },
    data: { releasedAt: now },
  });

  return { released: result.count };
}

export const reservationService = {
  available: (variantId: string) => availableStock(db, variantId),
  availableMany: (variantIds: string[]) => availableStockMany(db, variantIds),

  /**
   * Reserves a basket in its own transaction and mirrors to Redis afterwards.
   *
   * The timeout is raised above Prisma's 5s default: under contention these transactions
   * queue on a row lock, and a checkout that fails because it waited is worse than one that
   * waited a little longer.
   */
  reserveBasket: async (cartId: string, lines: ReservationLine[]): Promise<ReserveResult> => {
    const result = await db.$transaction((tx) => reserve(tx, cartId, lines), {
      timeout: 15_000,
      maxWait: 10_000,
    });

    if (result.kind === "ok") await mirrorToRedis(cartId, lines);
    return result;
  },

  release: async (cartId: string, reservationIds: string[], variantIds: string[]) => {
    const count = await db.$transaction((tx) => releaseReservations(tx, reservationIds));
    await forgetInRedis(cartId, variantIds);
    return count;
  },

  releaseForOrder: (orderId: string) => db.$transaction((tx) => releaseForOrder(tx, orderId)),
  attachToOrder: (ids: string[], orderId: string) =>
    db.$transaction((tx) => attachToOrder(tx, ids, orderId)),
  sweep: () => sweepExpiredReservations(db),
};
