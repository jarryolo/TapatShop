/**
 * Display formatting. Dates, numbers, and the small strings that appear in the UI.
 *
 * Timestamps are stored UTC and displayed in Asia/Manila — docs/CLAUDE.md. Every function
 * here passes the timezone explicitly rather than relying on the runtime's local zone,
 * because the server runs on a VPS whose clock is nobody's business and the admin may well
 * be looking at the dashboard from another country.
 */

export const MANILA = "Asia/Manila";
export const LOCALE = "en-PH";

/** "6 Aug 2026" */
export function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: MANILA,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toDate(value));
}

/** "6 Aug 2026, 12:30 pm" */
export function formatDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: MANILA,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(toDate(value));
}

/** "12:30 pm" */
export function formatTime(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: MANILA,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(toDate(value));
}

/**
 * The calendar date in Manila, as YYYY-MM-DD.
 *
 * Dashboard queries for "today's sales" need this. Slicing an ISO string instead gives the
 * UTC date, which is wrong for eight hours out of every twenty-four — an order placed at
 * 7am Manila on the 6th is still the 5th in UTC.
 */
export function manilaDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(toDate(value));
  return parts;
}

/** "1,234" — for counts and quantities, never for money. Use formatPeso for money. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

/** "2.5 kg" or "480 g", from a weight in grams. */
export function formatWeight(grams: number): string {
  if (!Number.isFinite(grams)) throw new TypeError(`grams must be finite, got ${grams}`);
  if (Math.abs(grams) >= 1000) {
    const kg = grams / 1000;
    const rounded = Math.round(kg * 100) / 100;
    return `${formatNumber(rounded)} kg`;
  }
  return `${formatNumber(grams)} g`;
}

/**
 * A PH delivery address on one line, in the order Filipinos actually write it:
 * street, barangay, city, province.
 */
export function formatAddressLine(address: {
  street: string;
  barangay: string;
  city: string;
  province: string;
  postalCode?: string | null;
}): string {
  const parts = [address.street, address.barangay, address.city, address.province];
  const line = parts.filter((p) => p.trim().length > 0).join(", ");
  return address.postalCode ? `${line} ${address.postalCode}` : line;
}

/** Truncates on a word boundary, with an ellipsis. Returns the input if it already fits. */
export function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}

/**
 * Order number format: TS-2026-000123. Sequence is zero-padded to six digits, which is
 * about 999,999 orders a year before it needs revisiting.
 */
export function formatOrderNo(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new TypeError(`sequence must be a positive integer, got ${sequence}`);
  }
  return `TS-${year}-${sequence.toString().padStart(6, "0")}`;
}

function toDate(value: Date | string): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${String(value)}`);
  }
  return date;
}
