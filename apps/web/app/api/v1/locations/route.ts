import { z } from "zod";

import { enforceRateLimit, ok } from "@/lib/api/respond";
import { REGIONS, barangaysFor, citiesFor, provincesFor } from "@/lib/data/ph-locations";

const querySchema = z.object({
  region: z.string().trim().optional(),
  province: z.string().trim().optional(),
  city: z.string().trim().optional(),
});

/**
 * One step of the address cascade: region → province → city → barangay.
 *
 * Served from a static module rather than the database — it is reference data that changes
 * when the PSA publishes a new PSGC, not when anyone uses the shop.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  const query = parsed.success ? parsed.data : {};

  if (query.city) {
    // May be empty: the dataset only has barangays for a few cities, and the form falls
    // back to free text so a partial dataset cannot block a sale.
    return ok({ level: "barangay", data: barangaysFor(query.city) });
  }

  if (query.province) {
    return ok({ level: "city", data: citiesFor(query.province) });
  }

  if (query.region) {
    return ok({ level: "province", data: provincesFor(query.region) });
  }

  return ok({ level: "region", data: REGIONS });
}
