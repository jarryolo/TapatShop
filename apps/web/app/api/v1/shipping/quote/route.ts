import { z } from "zod";

import { enforceRateLimit, fail, failValidation, ok } from "@/lib/api/respond";
import { shippingService } from "@/lib/services/shipping.service";

const querySchema = z.object({
  region: z.string().trim().min(1),
  subtotalCents: z.coerce.number().int().min(0),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/**
 * `?region=&subtotalCents=&weightGrams=` → the rates available — docs/04.
 *
 * **Display only.** `subtotalCents` comes from the browser, which makes this the one endpoint
 * where a client can name a figure that changes a price on screen — claim a subtotal above the
 * free-shipping threshold and the quote comes back free.
 *
 * That buys nothing, because checkout does not use this. `validateCheckout` re-quotes from the
 * cart's own subtotal and looks the chosen rate up among the options it computed itself, so a
 * basket below the threshold pays the fee whatever was quoted here. Both halves are covered in
 * checkout.service.integration.test.ts — if this endpoint is ever wired into pricing, those
 * tests are the ones that should stop it.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await shippingService.quote({
    regionCode: parsed.data.region,
    subtotalCents: parsed.data.subtotalCents,
    weightGrams: parsed.data.weightGrams,
  });

  if (result.kind === "unknown_region") {
    return fail("VALIDATION_ERROR", "That is not a Philippine region we recognise.");
  }

  if (result.kind === "no_service") {
    // A gap in the zone configuration, said plainly rather than quoted as free.
    return fail("NOT_FOUND", "We do not ship to that region yet.");
  }

  return ok({ data: result.options });
}
