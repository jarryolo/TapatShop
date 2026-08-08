import { PrismaClient } from "@tapatshop/db";
import { afterAll, describe, expect, it } from "vitest";

import { PROVINCES, REGIONS, isKnownRegion } from "@/lib/data/ph-locations";

import {
  barangaysForCity,
  citiesForProvince,
  citiesForRegion,
  provincesForRegion,
  regionKeyForProvince,
  regions,
} from "./locations.service";

/**
 * The PSGC tables, and the one thing that can silently break deliveries: drift between them
 * and the small static list shipping rates are keyed on.
 *
 * These tests read the imported dataset rather than fixtures, so they are a check on the
 * import as much as on the queries. They skip when the tables are empty — a fresh clone has
 * not run `pnpm db:import:psgc` yet, and failing there would just be noise.
 */

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

const imported = url ? Number(await db.phBarangay.count().catch(() => 0)) : 0;
const describeImported = imported > 0 ? describe : describe.skip;

describeImported("PH locations", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  describe("the imported dataset", () => {
    it("has the whole country, not a sample", async () => {
      // The hand-written list this replaced had 4 cities' worth of barangays. If a future
      // import half-fails, this is what says so.
      expect(await db.phRegion.count()).toBe(17);
      expect(await db.phProvince.count()).toBeGreaterThanOrEqual(80);
      expect(await db.phCity.count()).toBeGreaterThan(1_600);
      expect(await db.phBarangay.count()).toBeGreaterThan(41_000);
    });

    it("leaves no barangay without a city", async () => {
      // A barangay whose parent is missing is a hole in the cascade: the customers in it
      // cannot select their address at all.
      const orphans = await db.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM ph_barangays b
        LEFT JOIN ph_cities c ON c.code = b.cityCode
        WHERE c.code IS NULL`;
      expect(Number(orphans[0]?.n ?? 0)).toBe(0);
    });

    it("keeps the PSA's codes, so a re-import can be reconciled", async () => {
      const sample = await db.phBarangay.findFirst({ select: { code: true } });
      expect(sample?.code).toMatch(/^\d{9,10}$/);
    });
  });

  describe("agreement with the shipping map", () => {
    it("gives every imported region a key that shipping recognises", async () => {
      /**
       * The check that matters. Shipping zones are configured against these keys, so a region
       * whose key nothing recognises becomes "we do not ship there yet" for everyone in it —
       * and nothing else in the system would say so.
       */
      for (const region of await regions()) {
        expect(isKnownRegion(region.regionKey), `${region.name} → ${region.regionKey}`).toBe(true);
      }
    });

    it("uses each shipping key exactly once", async () => {
      const keys = (await regions()).map((region) => region.regionKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("covers every region the static list knows about", async () => {
      // Both directions: a key in the static list with no imported region behind it means a
      // zone that can never match an address.
      const imported = new Set((await regions()).map((r) => r.regionKey));
      for (const region of REGIONS) {
        expect(imported.has(region.code), `${region.code} has no imported region`).toBe(true);
      }
    });

    it("maps a province to the same region the static list does", async () => {
      // Sampled across the country rather than exhaustively — the static list exists only to
      // resolve stored addresses, and a spot check catches a wholesale mismatch.
      for (const name of ["Cebu", "Pampanga", "Bulacan", "Iloilo", "Benguet"]) {
        const province = await db.phProvince.findFirst({ where: { name } });
        if (!province) continue;

        const fromDb = await regionKeyForProvince(province.code);
        const fromStatic = PROVINCES.find((p) => p.name === name)?.regionCode;
        expect(fromDb, `${name}`).toBe(fromStatic);
      }
    });
  });

  describe("the cascade", () => {
    it("returns provinces for an ordinary region", async () => {
      const found = await provincesForRegion("Region VII");
      expect(found.length).toBeGreaterThan(0);
      expect(found.map((p) => p.name)).toContain("Cebu");
    });

    it("returns cities directly for NCR, which has no provinces", async () => {
      // The PSA files NCR's cities under the region. An empty province list there is correct,
      // and the endpoint skips a level rather than stranding a third of the country.
      expect(await provincesForRegion("NCR")).toHaveLength(0);

      const cities = await citiesForRegion("NCR");
      expect(cities.length).toBeGreaterThanOrEqual(16);
      expect(cities.map((c) => c.name)).toContain("City of Makati");
    });

    it("returns barangays for a city", async () => {
      /**
       * "City of Cebu", not "Cebu City" — the PSA writes the formal name and this test
       * originally guessed the colloquial one. Worth keeping as a reminder: anything matching
       * these names by hand will be wrong about roughly half of them, which is why the codes
       * are what the cascade and stored addresses key on.
       */
      const cebu = await db.phCity.findFirst({ where: { name: "City of Cebu" } });
      expect(cebu).not.toBeNull();

      const barangays = await barangaysForCity(cebu!.code);
      expect(barangays.length).toBeGreaterThan(20);
    });

    it("lists regions the way a PH form does, not roman numerals sorted as text", async () => {
      /**
       * Every column sorts this wrongly in its own way — `regionKey` puts Region IX above
       * Region V, the PSGC code separates IV-B from IV-A. All cheap to reintroduce, invisible
       * in a passing build, and it makes the first field of checkout look broken.
       */
      const listed = (await regions()).map((r) => r.regionKey);
      expect(listed).toEqual(REGIONS.map((r) => r.code));
    });

    it("sorts every level, so a dropdown of 40 is scannable", async () => {
      const cities = await citiesForProvince(
        (await db.phProvince.findFirstOrThrow({ where: { name: "Cebu" } })).code
      );
      const names = cities.map((c) => c.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it("returns nothing rather than throwing for a code that does not exist", async () => {
      // The form turns an empty list into a free-text field, which is the fallback that keeps
      // checkout working when the data is thin or the code is stale.
      expect(await barangaysForCity("000000000")).toEqual([]);
      expect(await provincesForRegion("Region ZZ")).toEqual([]);
    });
  });
});
