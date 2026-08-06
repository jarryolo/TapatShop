import { describe, expect, it } from "vitest";

import { filterRows, nextSort, paginate, sortRows } from "./table";

interface Row extends Record<string, unknown> {
  orderNo: string;
  customer: string;
  totalCents: number;
  tracking: string | null;
}

const rows: Row[] = [
  { orderNo: "TS-2026-000101", customer: "Ana Reyes", totalCents: 97000, tracking: null },
  { orderNo: "TS-2026-000102", customer: "Joel Santos", totalCents: 298800, tracking: "JNT-1" },
  { orderNo: "TS-2026-000103", customer: "maricel dizon", totalCents: 194800, tracking: "LBC-9" },
];

describe("sortRows", () => {
  it("returns a copy when there is no sort", () => {
    const result = sortRows(rows, null);
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it("does not mutate the input", () => {
    const before = [...rows];
    sortRows(rows, { key: "totalCents", direction: "desc" });
    expect(rows).toEqual(before);
  });

  it("sorts numbers numerically, not lexically", () => {
    const asc = sortRows(rows, { key: "totalCents", direction: "asc" });
    expect(asc.map((r) => r.totalCents)).toEqual([97000, 194800, 298800]);
  });

  it("sorts strings case-insensitively", () => {
    // Naive comparison puts "maricel" after every capitalised name.
    const asc = sortRows(rows, { key: "customer", direction: "asc" });
    expect(asc.map((r) => r.customer)).toEqual(["Ana Reyes", "Joel Santos", "maricel dizon"]);
  });

  it("reverses on desc", () => {
    const desc = sortRows(rows, { key: "totalCents", direction: "desc" });
    expect(desc.map((r) => r.totalCents)).toEqual([298800, 194800, 97000]);
  });

  it("keeps empty values last in both directions", () => {
    const asc = sortRows(rows, { key: "tracking", direction: "asc" });
    const desc = sortRows(rows, { key: "tracking", direction: "desc" });

    expect(asc.at(-1)?.tracking).toBeNull();
    expect(desc.at(-1)?.tracking).toBeNull();
  });

  it("handles an empty list", () => {
    expect(sortRows([], { key: "totalCents", direction: "asc" })).toEqual([]);
  });
});

describe("filterRows", () => {
  const keys = ["orderNo", "customer"] as const;

  it("returns everything for an empty or whitespace query", () => {
    expect(filterRows(rows, "", keys)).toHaveLength(3);
    expect(filterRows(rows, "   ", keys)).toHaveLength(3);
  });

  it("matches case-insensitively on a substring", () => {
    expect(filterRows(rows, "joel", keys).map((r) => r.orderNo)).toEqual(["TS-2026-000102"]);
    expect(filterRows(rows, "JOEL", keys).map((r) => r.orderNo)).toEqual(["TS-2026-000102"]);
  });

  it("matches a partial order number", () => {
    expect(filterRows(rows, "000103", keys)).toHaveLength(1);
  });

  it("only looks at the keys it is given", () => {
    // "JNT-1" is a tracking number, and tracking is not searchable here.
    expect(filterRows(rows, "JNT", keys)).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterRows(rows, "zzz", keys)).toEqual([]);
  });
});

describe("paginate", () => {
  it("slices a page", () => {
    const result = paginate(rows, 1, 2);
    expect(result.rows).toHaveLength(2);
    expect(result).toMatchObject({ page: 1, totalPages: 2, total: 3 });
  });

  it("returns the remainder on the last page", () => {
    expect(paginate(rows, 2, 2).rows).toHaveLength(1);
  });

  it("clamps a page past the end", () => {
    // Filtering down to fewer results while on page 5 is how tables end up looking empty.
    const result = paginate(rows, 99, 2);
    expect(result.page).toBe(2);
    expect(result.rows).toHaveLength(1);
  });

  it("clamps a page below one", () => {
    expect(paginate(rows, 0, 2).page).toBe(1);
    expect(paginate(rows, -5, 2).page).toBe(1);
  });

  it("reports one page for an empty list rather than zero", () => {
    const result = paginate([], 1, 10);
    expect(result).toMatchObject({ page: 1, totalPages: 1, total: 0 });
    expect(result.rows).toEqual([]);
  });

  it("rejects a nonsensical page size", () => {
    expect(() => paginate(rows, 1, 0)).toThrow(RangeError);
  });
});

describe("nextSort", () => {
  it("cycles asc, desc, then off", () => {
    const first = nextSort(null, "totalCents");
    expect(first).toEqual({ key: "totalCents", direction: "asc" });

    const second = nextSort(first, "totalCents");
    expect(second).toEqual({ key: "totalCents", direction: "desc" });

    expect(nextSort(second, "totalCents")).toBeNull();
  });

  it("starts fresh at asc when a different column is clicked", () => {
    const current = { key: "totalCents", direction: "desc" } as const;
    expect(nextSort(current, "customer")).toEqual({ key: "customer", direction: "asc" });
  });
});
