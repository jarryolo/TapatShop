import { describe, expect, it } from "vitest";

import {
  NCR_PROVINCE,
  PROVINCES,
  REGIONS,
  isKnownRegion,
  provincesFor,
  regionForProvince,
} from "@/lib/data/ph-locations";

import {
  basketWeightGrams,
  billableKilos,
  qualifiesForFreeShipping,
  rateFee,
} from "./shipping.service";

describe("billableKilos", () => {
  it("rounds up, because couriers do", () => {
    // 1,001g is two kilos to a courier. Rounding down means eating the difference on every
    // parcel that is a gram over.
    expect(billableKilos(1)).toBe(1);
    expect(billableKilos(1000)).toBe(1);
    expect(billableKilos(1001)).toBe(2);
    expect(billableKilos(2500)).toBe(3);
  });

  it("is zero for an empty basket", () => {
    expect(billableKilos(0)).toBe(0);
    expect(billableKilos(-5)).toBe(0);
  });
});

describe("rateFee", () => {
  const rate = { baseCents: 13_000, perKgCents: 3_000 };

  it("charges the base for the first kilo", () => {
    expect(rateFee(rate, 500)).toBe(13_000);
    expect(rateFee(rate, 1000)).toBe(13_000);
  });

  it("adds per-kilo for each kilo after the first", () => {
    expect(rateFee(rate, 1001)).toBe(16_000);
    expect(rateFee(rate, 3000)).toBe(19_000);
  });

  it("charges the base even for a weightless basket", () => {
    // Digital-only orders do not exist here, but a variant with no weight recorded should
    // not produce a free delivery.
    expect(rateFee(rate, 0)).toBe(13_000);
  });

  it("ignores per-kilo when the rate has none", () => {
    expect(rateFee({ baseCents: 8_000, perKgCents: 0 }, 9_000)).toBe(8_000);
  });
});

describe("qualifiesForFreeShipping", () => {
  const threshold = 250_000; // ₱2,500.00

  it("applies at exactly the boundary", () => {
    // The build plan asks for this case by name. A ₱2,500 threshold that does not fire on a
    // ₱2,500 order reads as dishonest, and customers notice immediately.
    expect(qualifiesForFreeShipping(250_000, threshold)).toBe(true);
  });

  it("does not apply one centavo below", () => {
    expect(qualifiesForFreeShipping(249_999, threshold)).toBe(false);
  });

  it("applies above", () => {
    expect(qualifiesForFreeShipping(250_001, threshold)).toBe(true);
  });

  it("never applies when the rate has no threshold", () => {
    expect(qualifiesForFreeShipping(10_000_000, null)).toBe(false);
  });

  it("handles a zero threshold as always free", () => {
    expect(qualifiesForFreeShipping(0, 0)).toBe(true);
  });
});

describe("basketWeightGrams", () => {
  it("multiplies weight by quantity", () => {
    expect(
      basketWeightGrams([
        { weightGrams: 250, quantity: 3 },
        { weightGrams: 1000, quantity: 1 },
      ])
    ).toBe(1750);
  });

  it("is zero for an empty basket", () => {
    expect(basketWeightGrams([])).toBe(0);
  });

  it("tolerates a variant with no weight recorded", () => {
    expect(basketWeightGrams([{ weightGrams: 0, quantity: 5 }])).toBe(0);
  });
});

describe("PH location data", () => {
  it("has all 17 regions", () => {
    expect(REGIONS).toHaveLength(17);
    expect(REGIONS.map((r) => r.code)).toContain("NCR");
    expect(REGIONS.map((r) => r.code)).toContain("BARMM");
  });

  it("has all 82 provinces", () => {
    expect(PROVINCES).toHaveLength(82);
  });

  it("gives every province a region that exists", () => {
    for (const province of PROVINCES) {
      expect(isKnownRegion(province.regionCode), `${province.name} → ${province.regionCode}`).toBe(
        true
      );
    }
  });

  it("has no duplicate province names", () => {
    const names = PROVINCES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("treats NCR as having one pseudo-province, so the cascade has four levels everywhere", () => {
    expect(provincesFor("NCR")).toEqual([NCR_PROVINCE]);
    expect(regionForProvince(NCR_PROVINCE)).toBe("NCR");
  });

  it("maps a province back to its region", () => {
    expect(regionForProvince("Cebu")).toBe("Region VII");
    expect(regionForProvince("Pampanga")).toBe("Region III");
    expect(regionForProvince("Nowhere")).toBeNull();
  });

  it("returns provinces sorted, so the dropdown is scannable", () => {
    const sorted = [...provincesFor("Region VII")].sort((a, b) => a.localeCompare(b));
    expect(provincesFor("Region VII")).toEqual(sorted);
  });
});
