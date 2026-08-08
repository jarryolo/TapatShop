/**
 * Regions and provinces, for shipping.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT THE ADDRESS CASCADE. That is the PSGC tables — `lib/services/locations.service.ts`,
 * loaded by `pnpm db:import:psgc` — which holds all 42,046 barangays.
 *
 * This file is the small part shipping needs to answer *synchronously*: `shipping.service.ts`
 * resolves a stored address to a zone while quoting, and reaching for the database on that
 * path would make every quote a round trip. Cities and barangays were removed when the
 * cascade moved to the database; nothing here needs them.
 *
 * So keep it small. If something needs more than a region or a province, it wants the
 * service, not this file. `code` is the string shipping zones are configured against, and the
 * integration tests assert these keys and the imported regions match in both directions — a
 * region here with no imported counterpart is a zone that can never match an address, and one
 * there with no key here is a region nothing ships to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Region {
  /** The code stored on orders and matched against ShippingZone.regions. */
  code: string;
  name: string;
}

export interface Province {
  name: string;
  regionCode: string;
}

export const REGIONS: Region[] = [
  { code: "NCR", name: "National Capital Region" },
  { code: "CAR", name: "Cordillera Administrative Region" },
  { code: "Region I", name: "Ilocos Region" },
  { code: "Region II", name: "Cagayan Valley" },
  { code: "Region III", name: "Central Luzon" },
  { code: "Region IV-A", name: "Calabarzon" },
  { code: "Region IV-B", name: "Mimaropa" },
  { code: "Region V", name: "Bicol Region" },
  { code: "Region VI", name: "Western Visayas" },
  { code: "Region VII", name: "Central Visayas" },
  { code: "Region VIII", name: "Eastern Visayas" },
  { code: "Region IX", name: "Zamboanga Peninsula" },
  { code: "Region X", name: "Northern Mindanao" },
  { code: "Region XI", name: "Davao Region" },
  { code: "Region XII", name: "Soccsksargen" },
  { code: "Region XIII", name: "Caraga" },
  { code: "BARMM", name: "Bangsamoro Autonomous Region in Muslim Mindanao" },
];

export const PROVINCES: Province[] = [
  // NCR has no provinces — it is divided into cities and one municipality.
  { name: "Abra", regionCode: "CAR" },
  { name: "Apayao", regionCode: "CAR" },
  { name: "Benguet", regionCode: "CAR" },
  { name: "Ifugao", regionCode: "CAR" },
  { name: "Kalinga", regionCode: "CAR" },
  { name: "Mountain Province", regionCode: "CAR" },

  { name: "Ilocos Norte", regionCode: "Region I" },
  { name: "Ilocos Sur", regionCode: "Region I" },
  { name: "La Union", regionCode: "Region I" },
  { name: "Pangasinan", regionCode: "Region I" },

  { name: "Batanes", regionCode: "Region II" },
  { name: "Cagayan", regionCode: "Region II" },
  { name: "Isabela", regionCode: "Region II" },
  { name: "Nueva Vizcaya", regionCode: "Region II" },
  { name: "Quirino", regionCode: "Region II" },

  { name: "Aurora", regionCode: "Region III" },
  { name: "Bataan", regionCode: "Region III" },
  { name: "Bulacan", regionCode: "Region III" },
  { name: "Nueva Ecija", regionCode: "Region III" },
  { name: "Pampanga", regionCode: "Region III" },
  { name: "Tarlac", regionCode: "Region III" },
  { name: "Zambales", regionCode: "Region III" },

  { name: "Batangas", regionCode: "Region IV-A" },
  { name: "Cavite", regionCode: "Region IV-A" },
  { name: "Laguna", regionCode: "Region IV-A" },
  { name: "Quezon", regionCode: "Region IV-A" },
  { name: "Rizal", regionCode: "Region IV-A" },

  { name: "Marinduque", regionCode: "Region IV-B" },
  { name: "Occidental Mindoro", regionCode: "Region IV-B" },
  { name: "Oriental Mindoro", regionCode: "Region IV-B" },
  { name: "Palawan", regionCode: "Region IV-B" },
  { name: "Romblon", regionCode: "Region IV-B" },

  { name: "Albay", regionCode: "Region V" },
  { name: "Camarines Norte", regionCode: "Region V" },
  { name: "Camarines Sur", regionCode: "Region V" },
  { name: "Catanduanes", regionCode: "Region V" },
  { name: "Masbate", regionCode: "Region V" },
  { name: "Sorsogon", regionCode: "Region V" },

  { name: "Aklan", regionCode: "Region VI" },
  { name: "Antique", regionCode: "Region VI" },
  { name: "Capiz", regionCode: "Region VI" },
  { name: "Guimaras", regionCode: "Region VI" },
  { name: "Iloilo", regionCode: "Region VI" },
  { name: "Negros Occidental", regionCode: "Region VI" },

  { name: "Bohol", regionCode: "Region VII" },
  { name: "Cebu", regionCode: "Region VII" },
  { name: "Negros Oriental", regionCode: "Region VII" },
  { name: "Siquijor", regionCode: "Region VII" },

  { name: "Biliran", regionCode: "Region VIII" },
  { name: "Eastern Samar", regionCode: "Region VIII" },
  { name: "Leyte", regionCode: "Region VIII" },
  { name: "Northern Samar", regionCode: "Region VIII" },
  { name: "Samar", regionCode: "Region VIII" },
  { name: "Southern Leyte", regionCode: "Region VIII" },

  { name: "Zamboanga del Norte", regionCode: "Region IX" },
  { name: "Zamboanga del Sur", regionCode: "Region IX" },
  { name: "Zamboanga Sibugay", regionCode: "Region IX" },

  { name: "Bukidnon", regionCode: "Region X" },
  { name: "Camiguin", regionCode: "Region X" },
  { name: "Lanao del Norte", regionCode: "Region X" },
  { name: "Misamis Occidental", regionCode: "Region X" },
  { name: "Misamis Oriental", regionCode: "Region X" },

  { name: "Davao de Oro", regionCode: "Region XI" },
  { name: "Davao del Norte", regionCode: "Region XI" },
  { name: "Davao del Sur", regionCode: "Region XI" },
  { name: "Davao Occidental", regionCode: "Region XI" },
  { name: "Davao Oriental", regionCode: "Region XI" },

  { name: "Cotabato", regionCode: "Region XII" },
  { name: "Sarangani", regionCode: "Region XII" },
  { name: "South Cotabato", regionCode: "Region XII" },
  { name: "Sultan Kudarat", regionCode: "Region XII" },

  { name: "Agusan del Norte", regionCode: "Region XIII" },
  { name: "Agusan del Sur", regionCode: "Region XIII" },
  { name: "Dinagat Islands", regionCode: "Region XIII" },
  { name: "Surigao del Norte", regionCode: "Region XIII" },
  { name: "Surigao del Sur", regionCode: "Region XIII" },

  { name: "Basilan", regionCode: "BARMM" },
  { name: "Lanao del Sur", regionCode: "BARMM" },
  { name: "Maguindanao del Norte", regionCode: "BARMM" },
  { name: "Maguindanao del Sur", regionCode: "BARMM" },
  { name: "Sulu", regionCode: "BARMM" },
  { name: "Tawi-Tawi", regionCode: "BARMM" },
];

/**
 * NCR's cities sit under this pseudo-province in *stored addresses*.
 *
 * The PSA files NCR's cities directly under the region and recognises no such province, so the
 * PSGC tables do not contain it. It stays here because addresses already saved carry it, and a
 * stored address must keep resolving to a shipping zone.
 */
export const NCR_PROVINCE = "Metro Manila";

export function provincesFor(regionCode: string): string[] {
  if (regionCode === "NCR") return [NCR_PROVINCE];
  return PROVINCES.filter((province) => province.regionCode === regionCode)
    .map((province) => province.name)
    .sort((a, b) => a.localeCompare(b));
}

/** The region a province belongs to. Used to price shipping from a stored address. */
export function regionForProvince(provinceName: string): string | null {
  if (provinceName === NCR_PROVINCE) return "NCR";
  return PROVINCES.find((province) => province.name === provinceName)?.regionCode ?? null;
}

export function isKnownRegion(code: string): boolean {
  return REGIONS.some((region) => region.code === code);
}
