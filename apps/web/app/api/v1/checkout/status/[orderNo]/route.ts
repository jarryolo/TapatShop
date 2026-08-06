import { enforceRateLimit, fail, ok } from "@/lib/api/respond";
import { db } from "@/lib/db";

/**
 * Polled by the confirmation page while the webhook lands — docs/06.
 *
 * The redirect back from the provider confirms nothing; only the webhook does. So this
 * reports what the database currently believes and the page keeps asking.
 *
 * Returns only the payment state, never the order contents: the order number alone must not
 * be enough to read someone's address. Full guest lookup needs the email too, via
 * GET /orders/track.
 */
export async function GET(request: Request, context: { params: Promise<{ orderNo: string }> }) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const { orderNo } = await context.params;

  const order = await db.order.findUnique({
    where: { orderNo },
    select: { orderNo: true, status: true, paymentStatus: true, totalCents: true, paidAt: true },
  });

  if (!order) return fail("NOT_FOUND", "That order does not exist.");

  return ok({ data: order });
}
