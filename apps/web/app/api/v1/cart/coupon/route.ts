import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { readCart, readCartContext, requireWritableCart } from "@/lib/cart-session";
import { db } from "@/lib/db";
import { applyCoupon, priceCart, removeCoupon } from "@/lib/services/cart.service";
import { couponSchema } from "@/lib/validators/checkout";

/** Applies a code. Validates eligibility and returns the recalculated cart — docs/04. */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const parsed = couponSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const context = await readCartContext(request);
  const { cartId } = await requireWritableCart(request);

  // Validated against the live subtotal, so a code with a minimum cannot be applied to a
  // basket that does not meet it.
  const priced = await priceCart(db, cartId, {
    memberPercent: context.memberPercent,
    userId: context.identity.userId,
    isMember: context.isMember,
  });

  const result = await applyCoupon(db, cartId, parsed.data.code, {
    subtotalCents: priced.subtotalCents,
    userId: context.identity.userId,
    isMember: context.isMember,
  });

  if (result.kind === "rejected") {
    return fail("VALIDATION_ERROR", result.message);
  }

  return ok({ data: await readCart(request) });
}

export async function DELETE(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const { cartId } = await requireWritableCart(request);
  await removeCoupon(db, cartId);

  return ok({ data: await readCart(request) });
}
