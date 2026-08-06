import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { readCart, requireWritableCart } from "@/lib/cart-session";
import { cartService } from "@/lib/services/cart.service";
import { addItemSchema } from "@/lib/validators/cart";

/** Adds a variant to the cart. Clamps to available stock and says so — docs/04. */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const parsed = addItemSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const { cartId } = await requireWritableCart(request);
  const result = await cartService.add(cartId, parsed.data.variantId, parsed.data.quantity);

  if (result.kind === "unavailable") {
    return fail("NOT_FOUND", "That item is no longer available.");
  }

  if (result.kind === "out_of_stock") {
    return fail("OUT_OF_STOCK", "That item is out of stock.", { available: 0 });
  }

  const cart = await readCart(request);

  return ok({
    data: cart,
    // The clamp is reported, never silent. Someone who asked for 10 and got 3 needs to know
    // before checkout, not at it.
    message: result.clamped
      ? `Only ${result.available} in stock, so we added ${result.quantity}.`
      : undefined,
  });
}
