import { z } from "zod";

import { enforceRateLimit, fail, failValidation, ok } from "@/lib/api/respond";
import { orderService } from "@/lib/services/order.service";

const querySchema = z.object({
  orderNo: z.string().trim().min(1).max(40),
  email: z.string().trim().toLowerCase().email(),
});

/**
 * Guest order lookup — docs/04, rate limited to 5/min per IP.
 *
 * docs/07 calls this out as the thing that absorbs most of the support volume that would
 * otherwise become account-recovery requests: someone locked out of their account can still
 * find out where their parcel is.
 *
 * Requires the order number *and* the email on the order. A wrong email returns the same
 * "not found" as a nonexistent order, so this cannot be used to probe which order numbers
 * are real.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "orderTracking");
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await orderService.track(parsed.data.orderNo, parsed.data.email);

  if (result.kind === "not_found") {
    return fail("NOT_FOUND", "We could not find an order with that number and email.");
  }

  return ok({ data: result.order });
}
