/**
 * Sorting, filtering, and pagination for admin tables.
 *
 * Pure functions, separate from the component, so the behaviour that actually matters can be
 * tested without rendering anything.
 */

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

/**
 * Stable sort by one key.
 *
 * Numbers compare numerically, strings with localeCompare so "Ana" and "ana" land together.
 * Nullish values always sort last regardless of direction — an empty tracking number at the
 * top of a descending sort is noise, never what someone was looking for.
 */
export function sortRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  sort: SortState | null
): T[] {
  if (!sort) return [...rows];

  const factor = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];

    const leftEmpty = left === null || left === undefined;
    const rightEmpty = right === null || right === undefined;
    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;

    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * factor;
    }
    return String(left).localeCompare(String(right), "en-PH", { numeric: true }) * factor;
  });
}

/** Case-insensitive substring match across the given keys. Empty query matches everything. */
export function filterRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  query: string,
  keys: readonly (keyof T)[]
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];

  return rows.filter((row) =>
    keys.some((key) => {
      const value = row[key];
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(needle);
    })
  );
}

export interface Page<T> {
  rows: T[];
  page: number;
  totalPages: number;
  total: number;
}

/**
 * Slices a page, clamping out-of-range requests.
 *
 * Filtering down to fewer results while on page 5 is the common way to end up staring at an
 * empty table, so the page is clamped to what exists rather than trusted.
 */
export function paginate<T>(rows: readonly T[], page: number, perPage: number): Page<T> {
  if (perPage < 1) throw new RangeError(`perPage must be at least 1, got ${perPage}`);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const clamped = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  const start = (clamped - 1) * perPage;

  return { rows: rows.slice(start, start + perPage), page: clamped, totalPages, total };
}

/** Click cycles asc, then desc, then off. The third click restores the natural order. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}
