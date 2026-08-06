import { z } from "zod";

/** Admin coupon payloads. Validated at the route boundary — docs/CLAUDE.md. */

const cents = z
  .number()
  .int("Amounts are in whole centavos — ₱1,234.50 is 123450.")
  .min(0, "An amount cannot be negative.")
  .max(Number.MAX_SAFE_INTEGER);

/**
 * The code as customers will type it: upper case, no spaces.
 *
 * Normalised here rather than at lookup so what an admin sees in the list is exactly what a
 * customer must type. Lowercase input is accepted and folded — nobody should get "invalid
 * code" for typing `save100`.
 */
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "A code needs at least three characters.")
  .max(40)
  .regex(/^[A-Z0-9-]+$/, "Codes can use letters, numbers and dashes.");

const base = z.object({
  code,
  type: z.enum(["percentage", "fixed", "free_shipping"]),
  valueCents: cents.nullish(),
  percentage: z
    .number()
    .int("Use a whole percentage.")
    .min(1, "A percentage coupon has to take at least 1% off.")
    .max(100, "100% is the most you can take off.")
    .nullish(),
  minSubtotalCents: cents.default(0),
  maxUses: z.number().int().min(1, "A limit of zero means nobody can use it.").nullish(),
  maxUsesPerUser: z.number().int().min(1).max(100).default(1),
  membersOnly: z.boolean().default(false),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  isActive: z.boolean().default(true),
});

/**
 * The rules that need more than one field to check.
 *
 * A percentage coupon with no percentage, or a fixed one with no amount, would save cleanly
 * and then discount nothing — the kind of bug that is only noticed by a customer at the till.
 */
interface CouponShape {
  type: "percentage" | "fixed" | "free_shipping";
  percentage?: number | null;
  valueCents?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

function checkShape(value: CouponShape, ctx: z.RefinementCtx): void {
  if (value.type === "percentage" && (value.percentage ?? 0) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["percentage"],
      message: "Say what percentage comes off.",
    });
  }

  if (value.type === "fixed" && (value.valueCents ?? 0) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["valueCents"],
      message: "Say how much comes off.",
    });
  }

  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "The end has to come after the start.",
    });
  }
}

/**
 * Only the field this type actually uses survives.
 *
 * A coupon switched from percentage to fixed must not keep a stale percentage, or a later
 * code path reads it and discounts by a rule nobody chose.
 */
function clearUnusedValue<T extends CouponShape>(value: T) {
  return {
    ...value,
    percentage: value.type === "percentage" ? (value.percentage ?? null) : null,
    valueCents: value.type === "fixed" ? (value.valueCents ?? null) : null,
  };
}

export const couponInputSchema = base.superRefine(checkShape).transform(clearUnusedValue);

export const couponPatchSchema = base
  .partial()
  .required({ type: true, code: true })
  .superRefine(checkShape)
  .transform(clearUnusedValue);

export type CouponInput = z.infer<typeof couponInputSchema>;
