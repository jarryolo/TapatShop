import { PrismaClient } from "../packages/db/generated/client/index.js";

/**
 * Imports the Philippine Standard Geographic Code — P3-01's outstanding pre-launch item.
 *
 *   pnpm db:import:psgc
 *
 * The hand-written dataset it replaces covered all 17 regions and 82 provinces but only NCR
 * and the largest city per region below that, because the full set is 42,046 barangays and
 * writing those by hand introduces errors that misroute deliveries silently.
 *
 * ## Where the data comes from
 *
 * The PSA publishes the PSGC as a spreadsheet at https://psa.gov.ph/classification/psgc.
 * This reads `psgc.gitlab.io`, which republishes that same publication as JSON — parsing the
 * PSA's .xlsx would mean adding a spreadsheet library to a project that has none.
 *
 * That is a mirror, so every row keeps its official 10-digit PSGC code. Reconciling this
 * import against the PSA's own file later is then a join on the code rather than a fuzzy match
 * on names, which get respelled between editions. **Before launch, someone should spot-check a
 * sample against the PSA publication** — a mirror is a convenience, not an authority.
 *
 * ## Re-running it
 *
 * Idempotent: rows are upserted by code, so re-running picks up a newer PSGC edition without
 * duplicating anything. Nothing is deleted — a barangay that disappears from a later edition
 * stays, because an address already saved against it must keep resolving.
 */

const API = "https://psgc.gitlab.io/api";

/**
 * PSGC region code → the key shipping zones are configured against.
 *
 * Explicit, and matched on the code rather than the name. Shipping rates are keyed on these
 * strings (see the zones in `seed.ts`), so getting one wrong routes a province into the wrong
 * zone and quietly charges the wrong delivery fee.
 *
 * Deriving them from names was tried and is a trap: the API returns short forms — "CALABARZON"
 * and "Caraga", not "REGION IV-A (CALABARZON)" — so a roman-numeral pattern matches nothing,
 * and a substring test for "CAR" matches *Caraga* as well as the Cordillera. Codes do not have
 * homographs.
 */
const REGION_KEY_BY_CODE = {
  "010000000": "Region I",
  "020000000": "Region II",
  "030000000": "Region III",
  "040000000": "Region IV-A",
  170000000: "Region IV-B",
  "050000000": "Region V",
  "060000000": "Region VI",
  "070000000": "Region VII",
  "080000000": "Region VIII",
  "090000000": "Region IX",
  100000000: "Region X",
  110000000: "Region XI",
  120000000: "Region XII",
  160000000: "Region XIII",
  130000000: "NCR",
  140000000: "CAR",
  150000000: "BARMM",
};

/**
 * Fails rather than guesses.
 *
 * When the PSA adds a region — Negros Island Region was created in 2024 — this stops the
 * import and asks for a decision. The alternative is inventing a key no shipping zone
 * references, which shows up as "we do not ship to that region yet" for everyone in it.
 */
function regionKeyFor(code, name) {
  const key = REGION_KEY_BY_CODE[code];
  if (!key) {
    throw new Error(
      `PSGC region ${code} (${name}) has no shipping key. Add it to REGION_KEY_BY_CODE ` +
        `and give it a shipping zone, or customers there cannot check out.`
    );
  }
  return key;
}

async function fetchJson(path) {
  const response = await fetch(`${API}/${path}/`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const db = new PrismaClient();

  console.warn("Fetching PSGC…");
  const [regions, provinces, cities, municipalities, subMunis, barangays] = await Promise.all([
    fetchJson("regions"),
    fetchJson("provinces"),
    fetchJson("cities"),
    fetchJson("municipalities"),
    fetchJson("sub-municipalities").catch(() => []),
    fetchJson("barangays"),
  ]);

  console.warn(
    `  ${regions.length} regions, ${provinces.length} provinces, ` +
      `${cities.length + municipalities.length + subMunis.length} cities/municipalities, ` +
      `${barangays.length} barangays`
  );

  // Sanity floor. A truncated response is otherwise indistinguishable from a real import that
  // simply wiped most of the country's addresses.
  if (regions.length < 15 || provinces.length < 70 || barangays.length < 40_000) {
    throw new Error("The dataset looks truncated — refusing to import a partial country.");
  }

  console.warn("Writing regions and provinces…");
  for (const region of regions) {
    await db.phRegion.upsert({
      where: { code: region.code },
      create: {
        code: region.code,
        name: region.name,
        regionKey: regionKeyFor(region.code, region.name),
      },
      update: { name: region.name, regionKey: regionKeyFor(region.code, region.name) },
    });
  }

  for (const province of provinces) {
    await db.phProvince.upsert({
      where: { code: province.code },
      create: { code: province.code, name: province.name, regionCode: province.regionCode },
      update: { name: province.name, regionCode: province.regionCode },
    });
  }

  /**
   * Cities, municipalities and sub-municipalities are three endpoints and one concept to a
   * customer choosing a delivery address, so they land in one table with a `kind`.
   *
   * NCR's cities have no province — the PSA files them directly under the region. A schema
   * that required one would have to invent "Metro Manila", which is what the hand-written
   * dataset did and why its provinces did not line up with the PSA's.
   */
  const places = [
    ...cities.map((c) => ({ ...c, kind: "City" })),
    ...municipalities.map((m) => ({ ...m, kind: "Municipality" })),
    ...subMunis.map((s) => ({ ...s, kind: "Sub-municipality" })),
  ];

  const provinceCodes = new Set(provinces.map((p) => p.code));

  console.warn(`Writing ${places.length} cities and municipalities…`);
  for (const place of places) {
    const provinceCode = provinceCodes.has(place.provinceCode) ? place.provinceCode : null;
    const data = {
      name: place.name,
      kind: place.kind,
      provinceCode,
      regionCode: place.regionCode,
    };
    await db.phCity.upsert({
      where: { code: place.code },
      create: { code: place.code, ...data },
      update: data,
    });
  }

  /**
   * Barangays in batches. 42,046 individual upserts is minutes of round trips; `createMany`
   * with `skipDuplicates` is one statement per batch, and the ones it skips are the rows a
   * re-import would not have changed anyway.
   */
  /**
   * A barangay hangs off exactly one of three parents, and the API reports the other two as
   * `false` rather than null.
   *
   * That distinction is not cosmetic: `??` falls through only on null and undefined, so
   * `cityCode ?? municipalityCode` returns `false` for every barangay under a municipality —
   * 34,085 of the 42,046, or 81% of the country — and each one is then dropped as an orphan.
   * `||` is what is wanted here, which is the rare case where it is the safer of the two.
   */
  const parentOf = (b) => b.cityCode || b.municipalityCode || b.subMunicipalityCode || null;

  const known = new Set(places.map((p) => p.code));
  const orphans = barangays.filter((b) => !known.has(parentOf(b)));
  const usable = barangays
    .map((b) => ({ code: b.code, name: b.name, cityCode: parentOf(b) }))
    .filter((b) => b.cityCode && known.has(b.cityCode));

  console.warn(`Writing ${usable.length} barangays…`);
  const BATCH = 2_000;
  for (let i = 0; i < usable.length; i += BATCH) {
    await db.phBarangay.createMany({ data: usable.slice(i, i + BATCH), skipDuplicates: true });
    process.stdout.write(`\r  ${Math.min(i + BATCH, usable.length)} / ${usable.length}`);
  }
  process.stdout.write("\n");

  /**
   * Refuse a partial import rather than report one.
   *
   * The first run of this script dropped 34,085 barangays and finished successfully, printing
   * a warning nobody would have read before deploying. A hole in the cascade is invisible
   * until a customer in one of those barangays cannot select their address and abandons the
   * order, so it fails here instead.
   *
   * A handful of genuine orphans is tolerable — the PSA does occasionally publish a barangay
   * whose parent has been dissolved — but a hundred means something structural is wrong.
   */
  if (orphans.length > 100) {
    throw new Error(
      `${orphans.length} of ${barangays.length} barangays have no matching city or ` +
        `municipality. That is a structural mismatch, not stray data — refusing to leave the ` +
        `address cascade with holes in it.`
    );
  }

  if (orphans.length > 0) {
    console.warn(`  ${orphans.length} barangays had no matching parent and were skipped.`);
  }

  const counts = {
    regions: await db.phRegion.count(),
    provinces: await db.phProvince.count(),
    cities: await db.phCity.count(),
    barangays: await db.phBarangay.count(),
  };
  console.warn(`Done. ${JSON.stringify(counts)}`);

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(`PSGC import failed: ${error.message}`);
  process.exit(1);
});
