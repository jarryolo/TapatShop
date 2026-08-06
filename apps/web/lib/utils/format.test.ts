import { describe, expect, it } from "vitest";

import {
  formatAddressLine,
  formatDate,
  formatDateTime,
  formatNumber,
  formatOrderNo,
  formatTime,
  formatWeight,
  manilaDateKey,
  truncate,
} from "./format";

// Manila is UTC+8 with no daylight saving, so these mappings are stable year-round.
const MIDDAY_UTC = "2026-08-06T04:30:00.000Z"; // 12:30 pm in Manila
const LATE_UTC = "2026-08-05T23:30:00.000Z"; // 7:30 am on the 6th in Manila
const EARLY_UTC = "2026-08-06T15:30:00.000Z"; // 11:30 pm on the 6th in Manila

// The Philippines writes dates month-day-year, which is what en-PH produces. Not a typo.
describe("formatDate", () => {
  it("formats in Manila time", () => {
    expect(formatDate(MIDDAY_UTC)).toBe("Aug 6, 2026");
  });

  it("uses the Manila calendar day, not the UTC one", () => {
    // 23:30 UTC on the 5th is already the 6th in Manila.
    expect(formatDate(LATE_UTC)).toBe("Aug 6, 2026");
  });

  it("accepts a Date as well as a string", () => {
    expect(formatDate(new Date(MIDDAY_UTC))).toBe("Aug 6, 2026");
  });

  it("throws on an unparseable date rather than rendering 'Invalid Date'", () => {
    expect(() => formatDate("not a date")).toThrow(TypeError);
  });
});

describe("formatDateTime and formatTime", () => {
  it("renders a 12-hour clock", () => {
    expect(formatDateTime(MIDDAY_UTC)).toContain("Aug 6, 2026");
    expect(formatTime(MIDDAY_UTC)).toMatch(/12:30/);
  });

  it("shifts the late-evening UTC case into the next Manila morning", () => {
    expect(formatTime(LATE_UTC)).toMatch(/7:30/);
  });
});

describe("manilaDateKey", () => {
  it("returns the Manila calendar date", () => {
    expect(manilaDateKey(MIDDAY_UTC)).toBe("2026-08-06");
  });

  it("is the reason 'today's sales' cannot slice an ISO string", () => {
    // Same instant: UTC says the 5th, Manila says the 6th.
    expect(LATE_UTC.slice(0, 10)).toBe("2026-08-05");
    expect(manilaDateKey(LATE_UTC)).toBe("2026-08-06");
  });

  it("stays on the same Manila day late in the evening", () => {
    expect(manilaDateKey(EARLY_UTC)).toBe("2026-08-06");
  });
});

describe("formatNumber", () => {
  it("groups thousands", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatWeight", () => {
  it("uses grams below a kilo", () => {
    expect(formatWeight(480)).toBe("480 g");
    expect(formatWeight(0)).toBe("0 g");
  });

  it("switches to kilos at exactly 1000", () => {
    expect(formatWeight(1000)).toBe("1 kg");
    expect(formatWeight(2500)).toBe("2.5 kg");
  });

  it("rounds to two decimals", () => {
    expect(formatWeight(1234)).toBe("1.23 kg");
  });

  it("rejects non-finite input", () => {
    expect(() => formatWeight(Number.NaN)).toThrow(TypeError);
  });
});

describe("formatAddressLine", () => {
  it("writes a PH address in the order people actually use", () => {
    expect(
      formatAddressLine({
        street: "24 Sampaguita Street, Project 4",
        barangay: "Bagumbayan",
        city: "Quezon City",
        province: "Metro Manila",
        postalCode: "1109",
      })
    ).toBe("24 Sampaguita Street, Project 4, Bagumbayan, Quezon City, Metro Manila 1109");
  });

  it("omits a missing postal code without leaving a trailing space", () => {
    expect(
      formatAddressLine({
        street: "88 Salinas Drive",
        barangay: "Lahug",
        city: "Cebu City",
        province: "Cebu",
      })
    ).toBe("88 Salinas Drive, Lahug, Cebu City, Cebu");
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("Tapat cap", 20)).toBe("Tapat cap");
  });

  it("clips on a word boundary", () => {
    expect(truncate("Brotherhood polo shirt in navy", 20)).toBe("Brotherhood polo…");
  });

  it("clips mid-word when there is no boundary to use", () => {
    expect(truncate("Brotherhoodpoloshirt", 10)).toBe("Brotherhoo…");
  });

  it("handles a zero limit", () => {
    expect(truncate("anything", 0)).toBe("");
  });
});

describe("formatOrderNo", () => {
  it("zero-pads to six digits", () => {
    expect(formatOrderNo(2026, 123)).toBe("TS-2026-000123");
    expect(formatOrderNo(2026, 1)).toBe("TS-2026-000001");
  });

  it("does not truncate past six digits", () => {
    expect(formatOrderNo(2026, 1234567)).toBe("TS-2026-1234567");
  });

  it("rejects a zero or negative sequence", () => {
    expect(() => formatOrderNo(2026, 0)).toThrow(TypeError);
  });
});
