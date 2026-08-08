import { z } from "zod";

import { enforceRateLimit, ok } from "@/lib/api/respond";
import {
  barangaysForCity,
  citiesForProvince,
  citiesForRegion,
  provincesForRegion,
  regions,
} from "@/lib/services/locations.service";

const querySchema = z.object({
  region: z.string().trim().optional(),
  province: z.string().trim().optional(),
  city: z.string().trim().optional(),
});

/**
 * One step of the address cascade: region → province → city → barangay.
 *
 * Served from the PSGC tables. It used to come from a bundled module, which is why the dataset
 * was deliberately partial — the address form is a client component, so a complete one would
 * have shipped all 42,046 barangays to every shopper. A step at a time is a few hundred rows.
 *
 * The response is a list of `{ code, name }`. Codes are the PSA's, so an address saved against
 * one survives a place being renamed, which names alone do not.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  const query = parsed.success ? parsed.data : {};

  if (query.city) {
    return ok({ level: "barangay", data: await barangaysForCity(query.city) });
  }

  if (query.province) {
    return ok({ level: "city", data: await citiesForProvince(query.province) });
  }

  if (query.region) {
    const provinces = await provincesForRegion(query.region);

    /**
     * NCR has no provinces — the PSA files its cities directly under the region. Rather than
     * showing an empty province list and stranding a third of the country's shoppers, the
     * cascade skips a level and returns cities.
     */
    if (provinces.length === 0) {
      return ok({ level: "city", data: await citiesForRegion(query.region) });
    }

    return ok({ level: "province", data: provinces });
  }

  return ok({ level: "region", data: await regions() });
}
