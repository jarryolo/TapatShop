import { z } from "zod";

import { enforceRateLimit, fail, failValidation, ok } from "@/lib/api/respond";
import { shippingService } from "@/lib/services/shipping.service";

const querySchema = z.object({
  region: z.string().trim().min(1),
  subtotalCents: z.coerce.number().int().min(0),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** `?region=&subtotalCents=&weightGrams=` → the rates available — docs/04. */
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
