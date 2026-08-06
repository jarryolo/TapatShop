import type { Prisma, PrismaClient } from "@tapatshop/db";

import { manilaDateKey } from "@/lib/utils/format";
import type { Cents } from "@/lib/utils/money";

/**
 * The admin dashboard figures — docs/01: today's sales, orders awaiting action, low stock,
 * top products this week.
 *
 * Extracted from the page because the page could not state the truth. It read the first eight
 * rows of each list and showed the length as the count, so "awaiting action: 8" meant "at
 * least 8" and there was no way to tell from the screen. A number on a dashboard is either
 * the real number or it is misinformation; a list next to it may be a sample, and says so.
 *
 * Every figure here is reconcilable: the tests recompute each one independently and compare.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** Rows shown beside each count. The count is never derived from this. */
const SAMPLE_SIZE = 8;

/** Payment states that mean money actually arrived. */
const PAID = ["paid", "partially_refunded", "refunded"] as const;

/**
 * The Manila calendar day, as a UTC instant range.
 *
 * An order placed at 7am Manila is still yesterday in UTC, so a dashboard on UTC days would
 * miss eight hours of orders every morning. Manila is UTC+8 with no daylight saving, which is
 * why a fixed offset is safe here and would not be somewhere else.
 */
export function manilaDay(now: Date): { start: Date; end: Date } {
  const key = manilaDateKey(now);
  return {
    start: new Date(`${key}T00:00:00.000+08:00`),
    end: new Date(`${key}T23:59:59.999+08:00`),
  };
}

/** The last seven Manila days, ending with today. */
export function manilaWeek(now: Date): { start: Date; end: Date } {
  const { start, end } = manilaDay(now);
  return { start: new Date(start.getTime() - 6 * 86_400_000), end };
}

export interface DashboardFigures {
  /** Paid today, less anything refunded on those orders. Gross would overstate a bad day. */
  salesTodayCents: Cents;
  paidOrdersToday: number;
  ordersPlacedToday: number;
  awaitingActionCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export async function dashboardFigures(tx: Db, now: Date = new Date()): Promise<DashboardFigures> {
  const { start, end } = manilaDay(now);

  const [paidToday, placedToday, awaiting, lowStock, outOfStock] = await Promise.all([
    tx.order.aggregate({
      where: { paidAt: { gte: start, lte: end }, paymentStatus: { in: [...PAID] } },
      _sum: { totalCents: true, refundedCents: true },
      _count: true,
    }),
    tx.order.count({ where: { placedAt: { gte: start, lte: end } } }),
    tx.order.count({ where: awaitingActionWhere() }),
    /**
     * Raw SQL, justified: this is a column-to-column comparison. Prisma has no way to express
     * `stockQty <= lowStockThreshold`, and the alternative — read every active variant and
     * filter in JavaScript — is what produced the wrong count this service replaces.
     */
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n
      FROM product_variants v
      JOIN products p ON p.id = v.productId
      WHERE v.isActive = 1 AND p.status = 'active' AND v.stockQty <= v.lowStockThreshold`,
    tx.productVariant.count({
      where: { isActive: true, stockQty: { lte: 0 }, product: { status: "active" } },
    }),
  ]);

  const gross = paidToday._sum.totalCents ?? 0;
  const refunded = paidToday._sum.refundedCents ?? 0;

  return {
    salesTodayCents: Math.max(0, gross - refunded) as Cents,
    paidOrdersToday: paidToday._count,
    ordersPlacedToday: placedToday,
    awaitingActionCount: awaiting,
    lowStockCount: Number(lowStock[0]?.n ?? 0),
    outOfStockCount: outOfStock,
  };
}

/** Paid, not cancelled, not yet packed. The queue the store actually works from. */
function awaitingActionWhere(): Prisma.OrderWhereInput {
  return {
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    status: { not: "cancelled" },
  };
}

export function awaitingActionSample(tx: Db) {
  return tx.order.findMany({
    where: awaitingActionWhere(),
    // Oldest first: the one that has been waiting longest is the one to pack next.
    orderBy: { createdAt: "asc" },
    take: SAMPLE_SIZE,
    select: {
      id: true,
      orderNo: true,
      customerName: true,
      totalCents: true,
      fulfillmentStatus: true,
      createdAt: true,
    },
  });
}

export async function lowStockSample(tx: Db) {
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT v.id
    FROM product_variants v
    JOIN products p ON p.id = v.productId
    WHERE v.isActive = 1 AND p.status = 'active' AND v.stockQty <= v.lowStockThreshold
    ORDER BY v.stockQty ASC
    LIMIT ${SAMPLE_SIZE}`;

  if (ids.length === 0) return [];

  const variants = await tx.productVariant.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    select: {
      id: true,
      sku: true,
      name: true,
      stockQty: true,
      lowStockThreshold: true,
      product: { select: { id: true, name: true } },
    },
  });

  // The IN query loses the ordering, so restore it — lowest stock is the most urgent.
  const order = new Map(ids.map((row, index) => [row.id, index]));
  return variants.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Top products over the last seven Manila days, by units sold on paid orders.
 *
 * Ranked by units rather than revenue on purpose: this answers "what is moving", which is a
 * restocking question. Revenue would put one expensive windbreaker above forty bags of coffee.
 */
export async function topProductsThisWeek(tx: Db, now: Date = new Date(), limit = 5) {
  const { start, end } = manilaWeek(now);

  const rows = await tx.orderItem.groupBy({
    by: ["variantId"],
    where: {
      order: { paidAt: { gte: start, lte: end }, paymentStatus: { in: [...PAID] } },
    },
    _sum: { quantity: true, lineTotalCents: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });

  const variantIds = rows.map((row) => row.variantId).filter((id): id is string => id !== null);
  if (variantIds.length === 0) return [];

  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, name: true, sku: true, product: { select: { id: true, name: true } } },
  });

  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  return rows.flatMap((row) => {
    const variant = row.variantId ? byId.get(row.variantId) : undefined;
    // A variant deleted since the sale still has order items, but nothing to link to. The
    // snapshot on the order item is the record; this list is navigation, so skip it.
    if (!variant) return [];

    return [
      {
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        variantName: variant.name,
        sku: variant.sku,
        unitsSold: row._sum.quantity ?? 0,
        revenueCents: (row._sum.lineTotalCents ?? 0) as Cents,
      },
    ];
  });
}

export function recentOrders(tx: Db, limit = 5) {
  return tx.order.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      orderNo: true,
      customerName: true,
      totalCents: true,
      paymentStatus: true,
    },
  });
}
