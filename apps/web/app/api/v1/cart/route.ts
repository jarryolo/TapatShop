import { enforceRateLimit, ok } from "@/lib/api/respond";
import { readCart } from "@/lib/cart-session";

/**
 * The priced cart. Recomputed from the database every time — docs/04.
 *
 * There is no cached total to go stale and nothing a client could send that would change the
 * arithmetic.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const cart = await readCart(request);
  return ok({ data: cart });
}
