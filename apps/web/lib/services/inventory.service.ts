import type { MovementReason, Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";

import { log } from "./audit.service";
import { claimAlertsFor, type PendingAlert, sendAlerts } from "./stock-alert.service";

/**
 * Inventory. The ledger is the truth; `ProductVariant.stockQty` is a derived cache.
 *
 * docs/03 decision 3: never write to stockQty except in the same transaction as a movement
 * row. Every function here that changes stock does both, or neither. That is what makes
 * invariant I4 (`stockQty == sum(movements.delta)`) hold, and what lets `reconcile()` rebuild
 * the number from scratch when something has gone wrong anyway.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** Reasons an admin may pick by hand. `sale` and `refund_return` are written by the system. */
export const MANUAL_REASONS = [
  "restock",
  "adjustment",
  "damage",
  "cancellation",
] as const satisfies readonly MovementReason[];

export type ManualReason = (typeof MANUAL_REASONS)[number];

export function isManualReason(value: string): value is ManualReason {
  return (MANUAL_REASONS as readonly string[]).includes(value);
}

export interface AdjustInput {
  variantId: string;
  /** Signed. Negative writes stock off, positive puts it back. Zero is rejected. */
  delta: number;
  reason: ManualReason;
  /** Free text. Required â€” see below. */
  note: string;
  actorId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type AdjustResult =
  | {
      kind: "ok";
      balanceAfter: number;
      movementId: string;
      /**
       * People to tell that this is back, claimed inside the transaction.
       *
       * Handed to the caller rather than emailed here: sending inside the transaction would
       * hold row locks across a network call, the same mistake checkout avoids with PayMongo.
       */
      alerts: PendingAlert[];
    }
  | { kind: "no_reason" }
  | { kind: "zero_delta" }
  | { kind: "would_go_negative"; stockQty: number }
  | { kind: "not_found" };

/**
 * Adjusts stock by hand.
 *
 * The note is mandatory â€” docs/01 and P4-03 both say so, and the reason is the entire point
 * of the ledger. "stockQty is 3 and I do not know why" is the failure this prevents, so an
 * adjustment with a reason code but no explanation is refused rather than accepted with an
 * empty string.
 */
export async function adjustStock(tx: Db, input: AdjustInput): Promise<AdjustResult> {
  if (!input.note.trim()) return { kind: "no_reason" };
  if (!Number.isInteger(input.delta) || input.delta === 0) return { kind: "zero_delta" };

  /**
   * Lock the variant before reading its stock.
   *
   * This is a read-modify-write on `stockQty`. Without the lock two admins adjusting the same
   * variant at once both read the same number and both write their own total, so one
   * adjustment vanishes while its movement row stays — which is exactly the drift
   * `reconcileStock` exists to find, arriving from a bug rather than from reality.
   *
   * It also serialises the back-in-stock claim below, since that runs in this transaction.
   */
  await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${input.variantId} FOR UPDATE`;

  const variant = await tx.productVariant.findUnique({
    where: { id: input.variantId },
    select: { id: true, sku: true, stockQty: true },
  });
  if (!variant) return { kind: "not_found" };

  const balanceAfter = variant.stockQty + input.delta;
  /**
   * The crossing that back-in-stock alerts fire on: nothing, then something.
   *
   * Read before the update, because after it there is no way to tell a restock from a top-up.
   * A level check ("stock > 0") would email the same people again on every later delivery.
   */
  const cameBackInStock = variant.stockQty <= 0 && balanceAfter > 0;
  // Physical stock cannot be negative. A write-off larger than what is on hand is a counting
  // error, and silently storing -2 makes every later number wrong.
  if (balanceAfter < 0) return { kind: "would_go_negative", stockQty: variant.stockQty };

  const movement = await tx.inventoryMovement.create({
    data: {
      variantId: input.variantId,
      delta: input.delta,
      reason: input.reason,
      actorId: input.actorId,
      note: input.note.trim(),
      balanceAfter,
    },
    select: { id: true },
  });

  await tx.productVariant.update({
    where: { id: input.variantId },
    data: { stockQty: balanceAfter },
  });

  await log(tx, {
    actorId: input.actorId,
    action: "inventory.adjust",
    entity: "ProductVariant",
    entityId: input.variantId,
    before: { stockQty: variant.stockQty },
    after: { stockQty: balanceAfter, delta: input.delta, reason: input.reason, note: input.note },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const alerts = cameBackInStock ? await claimAlertsFor(tx, input.variantId) : [];

  return { kind: "ok", balanceAfter, movementId: movement.id, alerts };
}

/**
 * Records a sale's stock movement. Called from the paid webhook â€” docs/06 step 5.
 *
 * Separate from adjustStock because it takes no note and no human actor, and because it is
 * allowed to drive stock negative: if the reservation and the payment raced, the money is
 * real and the order must still be recorded. docs/06 says mark it paid and flag it for an
 * admin rather than failing.
 */
export async function recordSale(
  tx: Db,
  variantId: string,
  quantity: number,
  orderId: string
): Promise<number> {
  const variant = await tx.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { stockQty: true },
  });

  const balanceAfter = variant.stockQty - quantity;

  await tx.inventoryMovement.create({
    data: {
      variantId,
      delta: -quantity,
      reason: "sale",
      orderId,
      balanceAfter,
      note: null,
    },
  });

  await tx.productVariant.update({ where: { id: variantId }, data: { stockQty: balanceAfter } });

  return balanceAfter;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  reads  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface StockFilters {
  q?: string;
  lowStockOnly?: boolean;
  outOfStockOnly?: boolean;
}

export async function stockList(tx: Db, filters: StockFilters = {}) {
  const variants = await tx.productVariant.findMany({
    where: {
      isActive: true,
      product: { status: { not: "archived" } },
      ...(filters.q?.trim()
        ? {
            OR: [
              { sku: { contains: filters.q.trim() } },
              { name: { contains: filters.q.trim() } },
              { product: { name: { contains: filters.q.trim() } } },
            ],
          }
        : {}),
      ...(filters.outOfStockOnly ? { stockQty: { lte: 0 } } : {}),
    },
    orderBy: [{ stockQty: "asc" }, { sku: "asc" }],
    select: {
      id: true,
      sku: true,
      name: true,
      stockQty: true,
      lowStockThreshold: true,
      product: { select: { id: true, name: true, status: true } },
    },
  });

  // Held stock, for the whole page in one query rather than one per variant.
  const held = await tx.stockReservation.groupBy({
    by: ["variantId"],
    where: {
      variantId: { in: variants.map((v) => v.id) },
      releasedAt: null,
      expiresAt: { gt: new Date() },
    },
    _sum: { quantity: true },
  });
  const heldBy = new Map(held.map((row) => [row.variantId, row._sum.quantity ?? 0]));

  const rows = variants.map((variant) => {
    const reserved = heldBy.get(variant.id) ?? 0;
    return {
      ...variant,
      reserved,
      // What a customer could actually buy right now â€” invariant I5.
      available: Math.max(0, variant.stockQty - reserved),
      isLow: variant.stockQty <= variant.lowStockThreshold,
    };
  });

  return filters.lowStockOnly ? rows.filter((row) => row.isLow) : rows;
}

/**
 * Movement history for one variant, newest first.
 *
 * `balanceAfter` is stored per row rather than recomputed, so the history reads as a running
 * balance even when rows are paginated or a movement is inserted out of order.
 */
export async function movementsFor(tx: Db, variantId: string, limit = 100) {
  return tx.inventoryMovement.findMany({
    where: { variantId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      delta: true,
      reason: true,
      note: true,
      balanceAfter: true,
      createdAt: true,
      orderId: true,
      actor: { select: { id: true, name: true } },
      order: { select: { orderNo: true } },
    },
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  reconciliation  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface Drift {
  variantId: string;
  sku: string;
  productName: string;
  /** What the cache says. */
  stockQty: number;
  /** What the ledger adds up to. */
  ledgerTotal: number;
  difference: number;
}

export interface ReconcileResult {
  checked: number;
  drift: Drift[];
  repaired: boolean;
}

/**
 * Rebuilds `stockQty` from the ledger and reports every disagreement.
 *
 * This is the point of keeping a ledger at all â€” docs/03: "A reconciliation job can rebuild
 * stockQty from the ledger; that's the point." Reports by default and only writes when asked,
 * because a silent repair hides the bug that caused the drift.
 */
export async function reconcileStock(
  tx: Db,
  options: { repair?: boolean } = {}
): Promise<ReconcileResult> {
  const variants = await tx.productVariant.findMany({
    select: { id: true, sku: true, stockQty: true, product: { select: { name: true } } },
  });

  const totals = await tx.inventoryMovement.groupBy({
    by: ["variantId"],
    _sum: { delta: true },
  });
  const ledgerBy = new Map(totals.map((row) => [row.variantId, row._sum.delta ?? 0]));

  const drift: Drift[] = [];

  for (const variant of variants) {
    const ledgerTotal = ledgerBy.get(variant.id) ?? 0;
    if (ledgerTotal !== variant.stockQty) {
      drift.push({
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        stockQty: variant.stockQty,
        ledgerTotal,
        difference: variant.stockQty - ledgerTotal,
      });
    }
  }

  if (options.repair) {
    for (const row of drift) {
      // The ledger wins. It is append-only and every row records who and why; the cache is
      // just a number somebody may have written by hand.
      await tx.productVariant.update({
        where: { id: row.variantId },
        data: { stockQty: row.ledgerTotal },
      });
    }
  }

  return { checked: variants.length, drift, repaired: Boolean(options.repair) };
}

export const inventoryService = {
  /**
   * Adjusts stock, then tells anyone who was waiting â€” after the commit, never inside it.
   *
   * A failed send must not roll back a stock movement. The ledger is the truth about what is
   * on the shelf; an email that bounced does not change what was counted.
   */
  adjust: async (input: AdjustInput) => {
    const result = await db.$transaction((tx) => adjustStock(tx, input));

    if (result.kind === "ok" && result.alerts.length > 0) {
      await sendAlerts(result.alerts);
    }

    return result;
  },
  list: (filters?: StockFilters) => stockList(db, filters),
  movements: (variantId: string, limit?: number) => movementsFor(db, variantId, limit),
  reconcile: (options?: { repair?: boolean }) => reconcileStock(db, options),
};
