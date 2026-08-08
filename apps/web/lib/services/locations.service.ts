import { REGIONS } from "@/lib/data/ph-locations";
import { db } from "@/lib/db";

/**
 * The PH address cascade, read from the PSGC tables — P3-01.
 *
 * These live in the database rather than a bundled module because there are 42,046 barangays.
 * The address form is a client component, so a module would have shipped the whole country to
 * every shopper; it calls `/api/v1/locations` a step at a time instead, which is a few hundred
 * rows per request.
 */

export interface Place {
  code: string;
  name: string;
}

/**
 * Ordered the way a Philippine form orders regions: NCR, CAR, I through XIII, BARMM.
 *
 * Neither column sorts correctly on its own. `regionKey` sorts the roman numerals as text and
 * puts Region IX above Region V. `name` mixes forms — "Ilocos Region" beside "CALABARZON" —
 * so alphabetising scatters the numbered regions. Even the PSGC code, which is the PSA's own
 * published sequence, trails MIMAROPA and Caraga after BARMM because they were assigned codes
 * later, which separates IV-B from IV-A.
 *
 * So the order comes from `REGIONS`, which is already written in the conventional sequence.
 * Reusing it costs nothing to maintain: the integration tests assert the two lists hold
 * exactly the same keys in both directions, so this cannot silently fall out of step.
 */
const REGION_ORDER = new Map(REGIONS.map((region, index) => [region.code, index]));

export async function regions(): Promise<(Place & { regionKey: string })[]> {
  const rows = await db.phRegion.findMany({
    select: { code: true, name: true, regionKey: true },
  });

  // An unrecognised key sorts last rather than disappearing — a new PSA region should still
  // be selectable while someone works out which shipping zone it belongs to.
  const rank = (key: string) => REGION_ORDER.get(key) ?? REGION_ORDER.size;
  return rows.sort((a, b) => rank(a.regionKey) - rank(b.regionKey) || a.code.localeCompare(b.code));
}

/** Provinces of a region, addressed by the shipping key ("NCR", "Region IV-A"). */
export async function provincesForRegion(regionKey: string): Promise<Place[]> {
  return db.phProvince.findMany({
    where: { region: { regionKey } },
    orderBy: { name: "asc" },
    select: { code: true, name: true },
  });
}

/**
 * Cities and municipalities of a province.
 *
 * NCR has none — the PSA files its cities directly under the region — so an empty result there
 * is correct rather than missing data, and `citiesForRegion` is what the form falls back to.
 */
export async function citiesForProvince(provinceCode: string): Promise<Place[]> {
  return db.phCity.findMany({
    where: { provinceCode },
    orderBy: { name: "asc" },
    select: { code: true, name: true },
  });
}

/** Cities filed directly under a region. In practice this is NCR. */
export async function citiesForRegion(regionKey: string): Promise<Place[]> {
  return db.phCity.findMany({
    where: { provinceCode: null, region: { regionKey } },
    orderBy: { name: "asc" },
    select: { code: true, name: true },
  });
}

export async function barangaysForCity(cityCode: string): Promise<Place[]> {
  return db.phBarangay.findMany({
    where: { cityCode },
    orderBy: { name: "asc" },
    select: { code: true, name: true },
  });
}

/**
 * The shipping key for a province, which is what a rate lookup needs.
 *
 * Checkout receives a region key from the form, but an address typed by hand may carry only a
 * province — this is how that resolves to a zone.
 */
export async function regionKeyForProvince(provinceCode: string): Promise<string | null> {
  const province = await db.phProvince.findUnique({
    where: { code: provinceCode },
    select: { region: { select: { regionKey: true } } },
  });
  return province?.region.regionKey ?? null;
}
