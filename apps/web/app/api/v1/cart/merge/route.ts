import { requireUser } from "@/lib/api/guard";
import { enforceRateLimit, ok } from "@/lib/api/respond";
import { CART_COOKIE, clearGuestCookie, readCart } from "@/lib/cart-session";
import { cartService } from "@/lib/services/cart.service";
import { cookies } from "next/headers";

/**
 * Folds the guest cart into the signed-in customer's cart. Called right after login.
 *
 * Requires a session: without it, anyone holding a guest token could merge a basket into an
 * account that is not theirs.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const jar = await cookies();
  const guestToken = request.headers.get("x-cart-token") ?? jar.get(CART_COOKIE)?.value ?? null;

  if (!guestToken) {
    // Nothing to merge is a success, not an error — the page calls this on every login.
    return ok({ data: await readCart(request), merged: 0 });
  }

  const summary = await cartService.merge(guestToken, guard.actor.id);

  // The guest cart is gone; keeping its cookie would create an empty one on the next write.
  await clearGuestCookie();

  return ok({
    data: await readCart(request),
    merged: summary.merged,
    message: summary.clamped > 0 ? "Some quantities were reduced to what is in stock." : undefined,
  });
}
