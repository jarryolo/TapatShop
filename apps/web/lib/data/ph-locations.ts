/**
 * Philippine administrative divisions, for the address cascade.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INCOMPLETE ON PURPOSE, AND THIS MATTERS BEFORE LAUNCH.
 *
 * All 17 regions and all 82 provinces are here and are the real ones. Cities,
 * municipalities and barangays are NOT complete — the Philippines has roughly 1,600
 * cities and municipalities and over 42,000 barangays, and that list cannot be written
 * out by hand without introducing errors that would silently misroute deliveries.
 *
 * What is here covers NCR in full plus the largest city in each other region, which is
 * enough to build and test the cascade against. Before launch, import the official
 * PSGC (Philippine Standard Geographic Code) dataset published quarterly by the PSA:
 *
 *   https://psa.gov.ph/classification/psgc
 *
 * The shape below is what the importer should produce. `shippingRegion` is the only field
 * the shipping calculation reads, so a bad import shows up as a wrong shipping fee rather
 * than a crash — check the region mapping first if quotes look wrong.
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

export interface City {
  name: string;
  province: string;
  /** Whether it is a city or a municipality. Only ever shown, never used in logic. */
  kind: "city" | "municipality";
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
 * NCR's cities are complete. Everywhere else has only the largest city, enough to exercise
 * the cascade — see the header. The full list comes from the PSGC import.
 */
export const CITIES: City[] = [
  // NCR — 16 cities and one municipality (Pateros). This list is complete.
  { name: "Caloocan", province: "Metro Manila", kind: "city" },
  { name: "Las Piñas", province: "Metro Manila", kind: "city" },
  { name: "Makati", province: "Metro Manila", kind: "city" },
  { name: "Malabon", province: "Metro Manila", kind: "city" },
  { name: "Mandaluyong", province: "Metro Manila", kind: "city" },
  { name: "Manila", province: "Metro Manila", kind: "city" },
  { name: "Marikina", province: "Metro Manila", kind: "city" },
  { name: "Muntinlupa", province: "Metro Manila", kind: "city" },
  { name: "Navotas", province: "Metro Manila", kind: "city" },
  { name: "Parañaque", province: "Metro Manila", kind: "city" },
  { name: "Pasay", province: "Metro Manila", kind: "city" },
  { name: "Pasig", province: "Metro Manila", kind: "city" },
  { name: "Pateros", province: "Metro Manila", kind: "municipality" },
  { name: "Quezon City", province: "Metro Manila", kind: "city" },
  { name: "San Juan", province: "Metro Manila", kind: "city" },
  { name: "Taguig", province: "Metro Manila", kind: "city" },
  { name: "Valenzuela", province: "Metro Manila", kind: "city" },

  // One per region beyond NCR. Partial by design.
  { name: "Baguio", province: "Benguet", kind: "city" },
  { name: "Laoag", province: "Ilocos Norte", kind: "city" },
  { name: "Dagupan", province: "Pangasinan", kind: "city" },
  { name: "Tuguegarao", province: "Cagayan", kind: "city" },
  { name: "San Fernando", province: "Pampanga", kind: "city" },
  { name: "Angeles", province: "Pampanga", kind: "city" },
  { name: "Malolos", province: "Bulacan", kind: "city" },
  { name: "Bacoor", province: "Cavite", kind: "city" },
  { name: "Dasmariñas", province: "Cavite", kind: "city" },
  { name: "Calamba", province: "Laguna", kind: "city" },
  { name: "Antipolo", province: "Rizal", kind: "city" },
  { name: "Batangas City", province: "Batangas", kind: "city" },
  { name: "Puerto Princesa", province: "Palawan", kind: "city" },
  { name: "Calapan", province: "Oriental Mindoro", kind: "city" },
  { name: "Legazpi", province: "Albay", kind: "city" },
  { name: "Naga", province: "Camarines Sur", kind: "city" },
  { name: "Iloilo City", province: "Iloilo", kind: "city" },
  { name: "Bacolod", province: "Negros Occidental", kind: "city" },
  { name: "Cebu City", province: "Cebu", kind: "city" },
  { name: "Mandaue", province: "Cebu", kind: "city" },
  { name: "Lapu-Lapu", province: "Cebu", kind: "city" },
  { name: "Tagbilaran", province: "Bohol", kind: "city" },
  { name: "Tacloban", province: "Leyte", kind: "city" },
  { name: "Zamboanga City", province: "Zamboanga del Sur", kind: "city" },
  { name: "Cagayan de Oro", province: "Misamis Oriental", kind: "city" },
  { name: "Iligan", province: "Lanao del Norte", kind: "city" },
  { name: "Davao City", province: "Davao del Sur", kind: "city" },
  { name: "General Santos", province: "South Cotabato", kind: "city" },
  { name: "Koronadal", province: "South Cotabato", kind: "city" },
  { name: "Butuan", province: "Agusan del Norte", kind: "city" },
  { name: "Surigao City", province: "Surigao del Norte", kind: "city" },
  { name: "Cotabato City", province: "Maguindanao del Norte", kind: "city" },
  { name: "Marawi", province: "Lanao del Sur", kind: "city" },
];

/**
 * Barangays are the level with 42,000 entries, so only a handful of examples are here.
 *
 * The address form falls back to a free-text barangay field for any city not listed, which
 * is what keeps checkout working on a partial dataset instead of blocking the sale.
 */
export const BARANGAYS: Record<string, string[]> = {
  "Quezon City": [
    "Bagumbayan",
    "Batasan Hills",
    "Commonwealth",
    "Diliman",
    "Fairview",
    "Holy Spirit",
    "Loyola Heights",
    "Novaliches",
    "Payatas",
    "Project 4",
    "San Francisco del Monte",
    "UP Campus",
  ],
  Makati: ["Bel-Air", "Poblacion", "San Antonio", "San Lorenzo", "Bangkal", "Guadalupe Nuevo"],
  "Cebu City": ["Lahug", "Guadalupe", "Mabolo", "Talamban", "Banilad", "Capitol Site"],
  "Davao City": ["Poblacion", "Buhangin", "Talomo", "Toril", "Agdao", "Matina"],
};

/** NCR's cities sit under this pseudo-province so the cascade has four levels everywhere. */
export const NCR_PROVINCE = "Metro Manila";

export function provincesFor(regionCode: string): string[] {
  if (regionCode === "NCR") return [NCR_PROVINCE];
  return PROVINCES.filter((province) => province.regionCode === regionCode)
    .map((province) => province.name)
    .sort((a, b) => a.localeCompare(b));
}

export function citiesFor(provinceName: string): City[] {
  return [...CITIES.filter((city) => city.province === provinceName)].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function barangaysFor(cityName: string): string[] {
  return BARANGAYS[cityName] ?? [];
}

/** The region a province belongs to. Used to price shipping from a stored address. */
export function regionForProvince(provinceName: string): string | null {
  if (provinceName === NCR_PROVINCE) return "NCR";
  return PROVINCES.find((province) => province.name === provinceName)?.regionCode ?? null;
}

export function isKnownRegion(code: string): boolean {
  return REGIONS.some((region) => region.code === code);
}
