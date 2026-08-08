import { Prisma } from "@tapatshop/db";
import type { Coupon, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";
import { type Cents, percentOf } from "@/lib/utils/money";

import { log } from "./audit.service";

/**
 * Coupon eligibility and discount calculation.
 *
 * Every rule is checked server-side, every time the cart is priced — docs/CLAUDE.md
 * invariant 2. A coupon that was valid when it was applied and has since expired, been used
 * up, or stopped matching the basket simply stops discounting; nothing has to update the
 * cart row for that to happen.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export type CouponRejection =
  | { reason: "not_found" }
  | { reason: "inactive" }
  | { reason: "not_started"; startsAt: Date }
  | { reason: "expired"; endsAt: Date }
  | { reason: "below_minimum"; minSubtotalCents: Cents }
  | { reason: "usage_limit_reached" }
  | { reason: "already_used_by_you"; maxUsesPerUser: number }
  | { reason: "members_only" };

export interface CouponContext {
  subtotalCents: Cents;
  shippingCents: Cents;
  userId?: string | null;
  /** A verified member — both memberVerifiedAt and emailVerifiedAt, per docs/01. */
  isMember: boolean;
  now?: Date;
}

export interface AppliedCoupon {
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  /** Off the subtotal. Free-shipping coupons discount shipping, not this. */
  discountCents: Cents;
  /** Off the shipping fee, for free-shipping coupons. */
  shippingDiscountCents: Cents;
}

export type CouponResult =
  { kind: "ok"; applied: AppliedCoupon } | ({ kind: "rejected" } & CouponRejection);

/** Wording a customer can act on — docs/05: say what happened and what to do. */
export function rejectionMessage(rejection: CouponRejection): string {
  switch (rejection.reason) {
    case "not_found":
      return "That code is not valid. Check the spelling and try again.";
    case "inactive":
      return "That code is no longer active.";
    case "not_started":
      return "That code is not active yet.";
    case "expired":
      return "That coupon has expired. Try another code.";
    case "below_minimum":
      return `That code needs a subtotal of at least ${formatMinimum(rejection.minSubtotalCents)}.`;
    case "usage_limit_reached":
      return "That code has been fully claimed.";
    case "already_used_by_you":
      return rejection.maxUsesPerUser === 1
        ? "You have already used that code."
        : `That code can only be used ${rejection.maxUsesPerUser} times per account.`;
    case "members_only":
      return "That code is for verified members only.";
  }
}

function formatMinimum(cents: Cents): string {
  return `₱${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

/**
 * The discount a coupon produces for this basket.
 *
 * Applied to the subtotal *after* member pricing, which is already baked into the line
 * unit prices — docs/01 defines the stacking order as member price first, coupon second.
 */
export function discountFor(
  coupon: Coupon,
  subtotalCents: Cents,
  shippingCents: Cents
): AppliedCoupon {
  switch (coupon.type) {
    case "percentage": {
      const percentage = coupon.percentage ?? 0;
      return {
        code: coupon.code,
        type: "percentage",
        // Rounded once, here, so the order total stays a whole number of centavos.
        discountCents: Math.min(percentOf(subtotalCents, percentage), subtotalCents),
        shippingDiscountCents: 0,
      };
    }

    case "fixed":
      return {
        code: coupon.code,
        type: "fixed",
        // Never more than the basket: a ₱500 coupon on a ₱300 order discounts ₱300, not
        // ₱500, or the total goes negative and the customer is owed money.
        discountCents: Math.min(coupon.valueCents ?? 0, subtotalCents),
        shippingDiscountCents: 0,
      };

    case "free_shipping":
      return {
        code: coupon.code,
        type: "free_shipping",
        discountCents: 0,
        shippingDiscountCents: shippingCents,
      };
  }
}

/**
 * Validates a code against every rule, in the order a customer would want to hear them.
 *
 * Usage counts are read live rather than trusted from the cart, so a code that hits its cap
 * between the cart page and checkout is caught at checkout.
 */
export async function validateCoupon(
  tx: Db,
  code: string,
  context: CouponContext
): Promise<CouponResult> {
  const now = context.now ?? new Date();
  const normalised = code.trim().toUpperCase();

  const coupon = await tx.coupon.findUnique({ where: { code: normalised } });
  if (!coupon) return { kind: "rejected", reason: "not_found" };
  if (!coupon.isActive) return { kind: "rejected", reason: "inactive" };

  if (coupon.startsAt && coupon.startsAt > now) {
    return { kind: "rejected", reason: "not_started", startsAt: coupon.startsAt };
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    return { kind: "rejected", reason: "expired", endsAt: coupon.endsAt };
  }

  // Members-only is checked before the money rules: telling a non-member they need to spend
  // more, when the code was never for them, wastes their time.
  if (coupon.membersOnly && !context.isMember) {
    return { kind: "rejected", reason: "members_only" };
  }

  if (context.subtotalCents < coupon.minSubtotalCents) {
    return {
      kind: "rejected",
      reason: "below_minimum",
      minSubtotalCents: coupon.minSubtotalCents,
    };
  }

  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return { kind: "rejected", reason: "usage_limit_reached" };
  }

  if (context.userId) {
    const usedByThisUser = await tx.couponRedemption.count({
      where: { couponId: coupon.id, userId: context.userId },
    });
    if (usedByThisUser >= coupon.maxUsesPerUser) {
      return {
        kind: "rejected",
        reason: "already_used_by_you",
        maxUsesPerUser: coupon.maxUsesPerUser,
      };
    }
  }

  return {
    kind: "ok",
    applied: discountFor(coupon, context.subtotalCents, context.shippingCents),
  };
}

// ─────────────────────────────  usage caps under concurrency  ─────────────────────────────

/**
 * How long a checkout may hold a use of a coupon without paying for it.
 *
 * The same window stock reservations get, and for the same reason: an unfinished checkout
 * should not permanently consume something another customer could have had. Kept as its own
 * constant rather than imported so a change to one is a deliberate decision about the other.
 */
export const COUPON_HOLD_SECONDS = 900;

/**
 * Uses currently spoken for: redeemed, plus checkouts still inside their hold window.
 *
 * `usedCount` alone is not the answer. It only moves when an order is paid, so between
 * checkout and the paid webhook a single-use code reads as unused and every simultaneous
 * buyer sails through validation. Counting unpaid-but-recent orders closes that window;
 * bounding it by time reopens the code when a checkout is abandoned, which is what the
 * redemption-time counting was protecting against in the first place.
 */
async function usesInFlight(
  // A transaction client, not `Db`: locking reads are meaningless outside one.
  tx: Prisma.TransactionClient,
  coupon: { id: string; code: string },
  now: Date,
  userId?: string | null
): Promise<number> {
  const heldSince = new Date(now.getTime() - COUPON_HOLD_SECONDS * 1000);

  /**
   * Locking reads, not `count()`.
   *
   * The caller already holds `FOR UPDATE` on the coupon row, which is what serialises claims —
   * but MySQL's default REPEATABLE READ means a *plain* read still answers from the snapshot
   * the transaction took at its first statement, long before that lock. So every concurrent
   * checkout counted the uses as they were before any of the others committed, and every one
   * of them was told the last use was still free.
   *
   * P5-04's load test caught it: a single-use coupon went to thirty of a hundred buyers. Same
   * root cause as the overselling bug in reservation.service, and it has to be fixed the same
   * way — the lock was never the missing piece, the freshness of the read was.
   */
  const [redeemedRow] = await tx.$queryRaw<{ n: bigint | number }[]>`
    SELECT COUNT(*) AS n FROM coupon_redemptions
    WHERE couponId = ${coupon.id}
      ${userId ? Prisma.sql`AND userId = ${userId}` : Prisma.empty}
    FOR UPDATE`;

  const [holdingRow] = await tx.$queryRaw<{ n: bigint | number }[]>`
    SELECT COUNT(*) AS n FROM orders
    WHERE couponCode = ${coupon.code}
      AND paymentStatus = 'awaiting_payment'
      AND status <> 'cancelled'
      AND placedAt >= ${heldSince}
      ${userId ? Prisma.sql`AND userId = ${userId}` : Prisma.empty}
    FOR UPDATE`;

  return Number(redeemedRow?.n ?? 0) + Number(holdingRow?.n ?? 0);
}

export type ClaimResult = { kind: "ok" } | ({ kind: "rejected" } & CouponRejection);

/**
 * Takes a use of a coupon for a checkout that is about to commit.
 *
 * Must run inside the checkout transaction, after the stock reservation locks. The row lock
 * is what makes the cap hold: without it two simultaneous checkouts both read the same
 * counts, both decide there is one use left, and both take it.
 */
export async function claimCoupon(
  tx: Prisma.TransactionClient,
  code: string,
  userId: string | null,
  now: Date = new Date()
): Promise<ClaimResult> {
  const normalised = code.trim().toUpperCase();

  /**
   * Raw SQL, justified per docs/03: Prisma cannot express SELECT ... FOR UPDATE, and the
   * lock is the entire mechanism here. Taken before any count is read, so the numbers below
   * cannot move underneath this transaction.
   */
  await tx.$queryRaw`SELECT id FROM coupons WHERE code = ${normalised} FOR UPDATE`;

  const coupon = await tx.coupon.findUnique({ where: { code: normalised } });
  if (!coupon) return { kind: "rejected", reason: "not_found" };

  if (coupon.maxUses !== null && (await usesInFlight(tx, coupon, now)) >= coupon.maxUses) {
    return { kind: "rejected", reason: "usage_limit_reached" };
  }

  if (userId && (await usesInFlight(tx, coupon, now, userId)) >= coupon.maxUsesPerUser) {
    return {
      kind: "rejected",
      reason: "already_used_by_you",
      maxUsesPerUser: coupon.maxUsesPerUser,
    };
  }

  return { kind: "ok" };
}

export type RedeemResult =
  | { kind: "ok"; usedCount: number }
  | { kind: "already_recorded" }
  | { kind: "not_found" }
  /** Recorded anyway — the payment is real — but the cap was passed and someone should look. */
  | { kind: "over_cap"; usedCount: number; maxUses: number };

/**
 * Records a redemption and increments the counter. Called only once an order is paid.
 *
 * Three things make this safe to call from a webhook that may fire twice:
 *
 *   - the coupon row is locked first, so `usedCount` is a real increment rather than a
 *     read-modify-write that two concurrent payments can both win
 *   - `(couponId, orderId)` is unique, so a replayed webhook is `already_recorded`, not a
 *     second use
 *   - going over the cap does not throw. By this point PayMongo has the customer's money and
 *     the discount is already on the order; refusing here would leave the books wrong in a
 *     worse way. It returns `over_cap` so the caller can flag the order instead.
 */
export async function redeemCoupon(
  tx: Prisma.TransactionClient,
  code: string,
  orderId: string,
  userId: string | null,
  discountCents: Cents
): Promise<RedeemResult> {
  const normalised = code.trim().toUpperCase();

  await tx.$queryRaw`SELECT id FROM coupons WHERE code = ${normalised} FOR UPDATE`;

  const coupon = await tx.coupon.findUnique({ where: { code: normalised } });
  if (!coupon) return { kind: "not_found" };

  const existing = await tx.couponRedemption.findFirst({
    where: { couponId: coupon.id, orderId },
    select: { id: true },
  });
  if (existing) return { kind: "already_recorded" };

  await tx.couponRedemption.create({
    data: { couponId: coupon.id, userId, orderId, discountCents },
  });

  const after = await tx.coupon.update({
    where: { id: coupon.id },
    data: { usedCount: { increment: 1 } },
    select: { usedCount: true },
  });

  if (coupon.maxUses !== null && after.usedCount > coupon.maxUses) {
    return { kind: "over_cap", usedCount: after.usedCount, maxUses: coupon.maxUses };
  }

  return { kind: "ok", usedCount: after.usedCount };
}

// ─────────────────────────────  admin CRUD  ─────────────────────────────

export interface CouponWrite {
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  valueCents?: number | null;
  percentage?: number | null;
  minSubtotalCents?: number;
  maxUses?: number | null;
  maxUsesPerUser?: number;
  membersOnly?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive?: boolean;
}

/**
 * The coupon list, with what each one has actually done.
 *
 * `usedCount` alone reads as activity but says nothing about cost. An admin deciding whether
 * to extend a code wants to know what it gave away, so the discount total is summed here.
 */
export async function listCouponsForAdmin(tx: Db) {
  const coupons = await tx.coupon.findMany({ orderBy: { createdAt: "desc" }, take: 500 });

  const totals = await tx.couponRedemption.groupBy({
    by: ["couponId"],
    where: { couponId: { in: coupons.map((coupon) => coupon.id) } },
    _sum: { discountCents: true },
    _count: true,
  });

  const byCoupon = new Map(totals.map((row) => [row.couponId, row]));

  return coupons.map((coupon) => ({
    ...coupon,
    redemptionCount: byCoupon.get(coupon.id)?._count ?? 0,
    discountedCents: (byCoupon.get(coupon.id)?._sum.discountCents ?? 0) as Cents,
  }));
}

export type SaveCouponResult =
  { kind: "ok"; id: string } | { kind: "code_taken" } | { kind: "not_found" };

export async function createCoupon(
  tx: Db,
  input: CouponWrite,
  actor: { id: string; ip?: string | null; userAgent?: string | null }
): Promise<SaveCouponResult> {
  const code = input.code.trim().toUpperCase();

  // Checked rather than left to the unique index, so the message can name the problem.
  const clash = await tx.coupon.findUnique({ where: { code }, select: { id: true } });
  if (clash) return { kind: "code_taken" };

  const coupon = await tx.coupon.create({ data: { ...input, code } });

  await log(tx, {
    actorId: actor.id,
    action: "coupon.create",
    entity: "Coupon",
    entityId: coupon.id,
    after: coupon,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok", id: coupon.id };
}

/**
 * Edits a coupon. `usedCount` is deliberately not writable.
 *
 * It is a record of what happened, not a setting. Letting an admin reset it to zero would
 * silently hand out a fresh batch of uses and leave the redemption rows saying otherwise.
 */
export async function updateCoupon(
  tx: Db,
  id: string,
  input: Partial<CouponWrite>,
  actor: { id: string; ip?: string | null; userAgent?: string | null }
): Promise<SaveCouponResult> {
  const before = await tx.coupon.findUnique({ where: { id } });
  if (!before) return { kind: "not_found" };

  if (input.code) {
    const code = input.code.trim().toUpperCase();
    const clash = await tx.coupon.findUnique({ where: { code }, select: { id: true } });
    if (clash && clash.id !== id) return { kind: "code_taken" };
    input = { ...input, code };
  }

  const after = await tx.coupon.update({ where: { id }, data: input });

  await log(tx, {
    actorId: actor.id,
    action: "coupon.update",
    entity: "Coupon",
    entityId: id,
    before,
    after,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok", id };
}

/**
 * Retires a coupon. Never deletes one that has been used.
 *
 * A redemption row points at its coupon, and the schema cascades — deleting a used coupon
 * would take the record of what it gave away with it. Deactivating stops it working and keeps
 * the history, which is what "delete" almost always means here.
 */
export async function deactivateCoupon(
  tx: Db,
  id: string,
  actor: { id: string; ip?: string | null; userAgent?: string | null }
): Promise<SaveCouponResult> {
  const before = await tx.coupon.findUnique({ where: { id } });
  if (!before) return { kind: "not_found" };

  const used = await tx.couponRedemption.count({ where: { couponId: id } });

  if (used === 0) {
    await tx.coupon.delete({ where: { id } });
  } else {
    await tx.coupon.update({ where: { id }, data: { isActive: false } });
  }

  await log(tx, {
    actorId: actor.id,
    action: used === 0 ? "coupon.delete" : "coupon.update",
    entity: "Coupon",
    entityId: id,
    before,
    after: used === 0 ? null : { isActive: false },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok", id };
}

export const couponService = {
  validate: (code: string, context: CouponContext) => validateCoupon(db, code, context),
  redeem: (code: string, orderId: string, userId: string | null, discountCents: Cents) =>
    db.$transaction((tx) => redeemCoupon(tx, code, orderId, userId, discountCents)),
  list: () => listCouponsForAdmin(db),
  get: (id: string) => db.coupon.findUnique({ where: { id } }),
  create: (input: CouponWrite, actor: Parameters<typeof createCoupon>[2]) =>
    db.$transaction((tx) => createCoupon(tx, input, actor)),
  update: (id: string, input: Partial<CouponWrite>, actor: Parameters<typeof updateCoupon>[3]) =>
    db.$transaction((tx) => updateCoupon(tx, id, input, actor)),
  deactivate: (id: string, actor: Parameters<typeof deactivateCoupon>[2]) =>
    db.$transaction((tx) => deactivateCoupon(tx, id, actor)),
};
