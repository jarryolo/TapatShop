import type { Coupon, Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";
import { type Cents, percentOf } from "@/lib/utils/money";

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

/**
 * Records a redemption and increments the counter. Called only once an order is paid.
 *
 * Counting at checkout instead would let an abandoned checkout burn a single-use code, and
 * the customer would have no way to get it back.
 */
export async function redeemCoupon(
  tx: Db,
  code: string,
  orderId: string,
  userId: string | null,
  discountCents: Cents
): Promise<void> {
  const coupon = await tx.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!coupon) return;

  await tx.couponRedemption.create({
    data: { couponId: coupon.id, userId, orderId, discountCents },
  });
  await tx.coupon.update({
    where: { id: coupon.id },
    data: { usedCount: { increment: 1 } },
  });
}

export const couponService = {
  validate: (code: string, context: CouponContext) => validateCoupon(db, code, context),
  redeem: (code: string, orderId: string, userId: string | null, discountCents: Cents) =>
    redeemCoupon(db, code, orderId, userId, discountCents),
};
