import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { readCart, requireWritableCart } from "@/lib/cart-session";
import { cartService } from "@/lib/services/cart.service";
import { updateItemSchema } from "@/lib/validators/cart";

type Context = { params: Promise<{ id: string }> };

/** Sets a line's quantity. Zero removes it. */
export async function PATCH(request: Request, context: Context) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const parsed = updateItemSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const { id } = await context.params;
  const { cartId } = await requireWritableCart(request);
  const result = await cartService.update(cartId, id, parsed.data.quantity);

  // Scoped to the caller's own cart, so this is also what a guessed id gets.
  if (result.kind === "not_found") return fail("NOT_FOUND", "That item is not in your cart.");

  const cart = await readCart(request);

  return ok({
    data: cart,
    message:
      result.kind === "ok" && result.clamped
        ? `Only ${result.available} in stock, so the quantity is now ${result.quantity}.`
        : undefined,
  });
}

export async function DELETE(request: Request, context: Context) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const { id } = await context.params;
  const { cartId } = await requireWritableCart(request);

  const removed = await cartService.remove(cartId, id);
  if (!removed) return fail("NOT_FOUND", "That item is not in your cart.");

  return ok({ data: await readCart(request) });
}
