import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { readCartContext } from "@/lib/cart-session";
import { findCartId } from "@/lib/services/cart.service";
import { checkoutService } from "@/lib/services/checkout.service";
import { db } from "@/lib/db";
import { validateCheckoutSchema } from "@/lib/validators/checkout";

/**
 * Re-prices the cart and reports anything that changed since the customer last looked.
 *
 * Reserves nothing. This is what makes "price or stock changes are surfaced before payment,
 * not after" true — the checkout page calls it before showing the pay button.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const parsed = validateCheckoutSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const context = await readCartContext(request);
  const cartId = await findCartId(db, context.identity);
  if (!cartId) return fail("NOT_FOUND", "Your cart is empty.");

  const result = await checkoutService.validate(
    cartId,
    {
      userId: context.identity.userId,
      email: "",
      name: "",
      phone: "",
      isMember: context.isMember,
      memberPercent: context.memberPercent,
    },
    parsed.data.address,
    {
      shippingRateId: parsed.data.shippingRateId,
      seenSubtotalCents: parsed.data.seenSubtotalCents,
    }
  );

  switch (result.kind) {
    case "empty_cart":
      return fail("NOT_FOUND", "Your cart is empty.");

    case "no_service":
      return fail("NOT_FOUND", "We do not ship to that region yet.");

    case "unavailable_lines":
      return fail("CART_STALE", "Some items are no longer available.", {
        changes: result.changes,
      });

    case "ok":
      return ok({ data: result.quote });
  }
}
