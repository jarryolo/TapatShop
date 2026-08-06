import { describe, expect, it } from "vitest";

import {
  MoneyError,
  applyPercentageDiscount,
  assertCents,
  formatPeso,
  lineTotal,
  memberUnitPrice,
  orderTotal,
  percentOf,
  sumCents,
  toCents,
  toPesos,
} from "./money";

describe("formatPeso", () => {
  it("formats the acceptance criterion from the build plan", () => {
    expect(formatPeso(123450)).toBe("₱1,234.50");
  });

  it("handles zero", () => {
    expect(formatPeso(0)).toBe("₱0.00");
  });

  it("pads centavos", () => {
    expect(formatPeso(5)).toBe("₱0.05");
    expect(formatPeso(50)).toBe("₱0.50");
    expect(formatPeso(100)).toBe("₱1.00");
  });

  it("puts the sign before the symbol, so refunds read correctly", () => {
    expect(formatPeso(-123450)).toBe("-₱1,234.50");
    expect(formatPeso(-5)).toBe("-₱0.05");
  });

  it("groups thousands at every boundary", () => {
    expect(formatPeso(99900)).toBe("₱999.00");
    expect(formatPeso(100000)).toBe("₱1,000.00");
    expect(formatPeso(100000000)).toBe("₱1,000,000.00");
    expect(formatPeso(123456789012)).toBe("₱1,234,567,890.12");
  });

  it("can omit the symbol for CSV columns", () => {
    expect(formatPeso(123450, { symbol: false })).toBe("1,234.50");
  });

  it("refuses fractional centavos rather than rounding them silently", () => {
    expect(() => formatPeso(12.5)).toThrow(MoneyError);
  });

  it("refuses NaN and Infinity", () => {
    expect(() => formatPeso(Number.NaN)).toThrow(MoneyError);
    expect(() => formatPeso(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe("assertCents", () => {
  it("accepts zero and negatives", () => {
    expect(() => assertCents(0)).not.toThrow();
    expect(() => assertCents(-1)).not.toThrow();
  });

  it("rejects anything past the safe integer range", () => {
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
  });
});

describe("toPesos and toCents", () => {
  it("round-trips", () => {
    expect(toPesos(123450)).toBe(1234.5);
    expect(toCents(1234.5)).toBe(123450);
  });

  it("rounds rather than producing a fractional centavo", () => {
    expect(toCents(12.345)).toBe(1235);
    expect(toCents(0.001)).toBe(0);
  });
});

describe("percentOf", () => {
  it("returns whole centavos", () => {
    expect(percentOf(100000, 10)).toBe(10000);
    expect(percentOf(48000, 12)).toBe(5760);
  });

  it("rounds half up on the absolute value", () => {
    // 5 % of 1 centavo is 0.05 -> 0
    expect(percentOf(1, 5)).toBe(0);
    // 50 % of 1 centavo is 0.5 -> 1
    expect(percentOf(1, 50)).toBe(1);
    // 10 % of 125 is 12.5 -> 13
    expect(percentOf(125, 10)).toBe(13);
  });

  it("rounds negatives symmetrically, so a refund reverses its sale exactly", () => {
    expect(percentOf(-125, 10)).toBe(-13);
    expect(percentOf(-1, 50)).toBe(-1);
    expect(percentOf(125, 10) + percentOf(-125, 10)).toBe(0);
  });

  it("handles the boundary percentages", () => {
    expect(percentOf(123450, 0)).toBe(0);
    expect(percentOf(123450, 100)).toBe(123450);
  });

  it("rejects percentages outside 0 to 100", () => {
    expect(() => percentOf(1000, -1)).toThrow(MoneyError);
    expect(() => percentOf(1000, 101)).toThrow(MoneyError);
  });

  it("stays exact on large values", () => {
    expect(percentOf(999999999, 10)).toBe(100000000);
  });
});

describe("applyPercentageDiscount", () => {
  it("subtracts the rounded discount", () => {
    expect(applyPercentageDiscount(100000, 10)).toBe(90000);
    expect(applyPercentageDiscount(125, 10)).toBe(112);
  });

  it("never goes below zero", () => {
    expect(applyPercentageDiscount(0, 50)).toBe(0);
    expect(applyPercentageDiscount(100000, 100)).toBe(0);
  });
});

describe("memberUnitPrice", () => {
  it("matches the worked example in docs/01", () => {
    // ₱1,250.00 at 10 % -> ₱1,125.00
    expect(memberUnitPrice(125000, 10)).toBe(112500);
    // ₱690.00 at 10 % -> ₱621.00
    expect(memberUnitPrice(69000, 10)).toBe(62100);
  });

  it("is a no-op at zero percent, which is how member pricing is switched off", () => {
    expect(memberUnitPrice(48000, 0)).toBe(48000);
  });

  it("keeps invariant I2 exact even where the discount lands on a half centavo", () => {
    // 10 % of 125 is 12.5. Rounding per unit gives 112 x 4 = 448.
    // Rounding the line total instead would give 500 - 50 = 450. The difference is the bug.
    const unit = memberUnitPrice(125, 10);
    const quantity = 4;

    expect(lineTotal(unit, quantity)).toBe(448);
    expect(lineTotal(unit, quantity)).toBe(unit * quantity);
  });

  it("holds across a range of prices and quantities", () => {
    for (const price of [1, 7, 99, 125, 333, 48000, 125000, 999999]) {
      for (const quantity of [1, 2, 3, 7, 13]) {
        const unit = memberUnitPrice(price, 10);
        expect(lineTotal(unit, quantity)).toBe(unit * quantity);
        expect(Number.isInteger(unit)).toBe(true);
      }
    }
  });
});

describe("lineTotal", () => {
  it("multiplies", () => {
    expect(lineTotal(48000, 3)).toBe(144000);
  });

  it("returns zero for a zero quantity", () => {
    expect(lineTotal(48000, 0)).toBe(0);
  });

  it("rejects fractional or negative quantities", () => {
    expect(() => lineTotal(48000, 1.5)).toThrow(MoneyError);
    expect(() => lineTotal(48000, -1)).toThrow(MoneyError);
  });
});

describe("sumCents", () => {
  it("sums an empty list to zero", () => {
    expect(sumCents([])).toBe(0);
  });

  it("sums mixed signs", () => {
    expect(sumCents([100000, 17500, -19700])).toBe(97800);
  });

  it("rejects an overflowing sum rather than returning an imprecise one", () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyError);
  });
});

describe("orderTotal", () => {
  it("computes invariant I1", () => {
    expect(
      orderTotal({
        subtotalCents: 197000,
        shippingCents: 17500,
        vatCents: 0,
        discountCents: 19700,
      })
    ).toBe(194800);
  });

  it("defaults the optional parts to zero", () => {
    expect(orderTotal({ subtotalCents: 298800 })).toBe(298800);
  });

  it("allows a total of zero", () => {
    expect(orderTotal({ subtotalCents: 100000, discountCents: 100000 })).toBe(0);
  });

  it("rejects fractional inputs", () => {
    expect(() => orderTotal({ subtotalCents: 100.5 })).toThrow(MoneyError);
  });
});
