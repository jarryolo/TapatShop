/**
 * Centavo arithmetic and peso formatting.
 *
 * Every monetary value in this system is an integer count of centavos. ₱480.00 is 48000.
 * No floats, no Decimal, no string math — see docs/CLAUDE.md. Formatting happens here and
 * nowhere else, at the render layer only.
 *
 * The rule behind every function below: round exactly once, as early as possible, at the
 * per-unit level. Rounding a line total or a subtotal is what produces invoices that are
 * one centavo off and reconciliation reports nobody can tie out.
 */

/** An integer count of centavos. */
export type Cents = number;

const PESO = "₱";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Guards the boundary. Anything that is not a whole, finite number of centavos is a bug
 * upstream, and failing here is far cheaper than storing it.
 */
export function assertCents(value: number, label = "value"): asserts value is Cents {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number of centavos, got ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be whole centavos, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range: ${value}`);
  }
}

export function isCents(value: number): value is Cents {
  return Number.isSafeInteger(value);
}

/**
 * Formats centavos as pesos: 123450 becomes "₱1,234.50".
 *
 * Always two decimals, comma thousands separator, peso sign — docs/CLAUDE.md. Negative
 * amounts render with the sign before the symbol ("-₱1,234.50") because that is how a
 * refund line should read on an invoice.
 */
export function formatPeso(cents: Cents, options: { symbol?: boolean } = {}): string {
  assertCents(cents, "cents");
  const { symbol = true } = options;

  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const pesos = Math.trunc(absolute / 100);
  const remainder = absolute % 100;

  const whole = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${whole}.${remainder.toString().padStart(2, "0")}`;

  return `${negative ? "-" : ""}${symbol ? PESO : ""}${body}`;
}

/** Centavos to a decimal peso number. For CSV export and provider payloads only. */
export function toPesos(cents: Cents): number {
  assertCents(cents, "cents");
  return cents / 100;
}

/** Pesos to centavos. Rounds, so 12.345 becomes 1235 rather than a fractional centavo. */
export function toCents(pesos: number): Cents {
  if (!Number.isFinite(pesos)) {
    throw new MoneyError(`pesos must be a finite number, got ${pesos}`);
  }
  return Math.round(pesos * 100);
}

/**
 * The percentage of an amount, rounded to whole centavos exactly once.
 *
 * Half-up on the absolute value, so -50 and 50 round symmetrically. JavaScript's Math.round
 * breaks ties toward positive infinity (-0.5 rounds to -0), which would make a refund and
 * the sale it reverses differ by a centavo.
 */
export function percentOf(cents: Cents, percent: number): Cents {
  assertCents(cents, "cents");
  if (!Number.isFinite(percent)) {
    throw new MoneyError(`percent must be a finite number, got ${percent}`);
  }
  if (percent < 0 || percent > 100) {
    throw new MoneyError(`percent must be between 0 and 100, got ${percent}`);
  }

  const sign = cents < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(cents) * percent) / 100);
}

/**
 * Applies a percentage discount, never below zero.
 *
 * Use for coupons at the subtotal level. For member pricing use memberUnitPrice, which is
 * the same arithmetic but named for where it must be applied.
 */
export function applyPercentageDiscount(cents: Cents, percent: number): Cents {
  const discount = percentOf(cents, percent);
  return Math.max(0, cents - discount);
}

/**
 * A verified member's price for one unit. See docs/01-product-spec.md.
 *
 * Per unit and rounded once, so `lineTotal(memberUnitPrice(p, pct), qty)` still satisfies
 * invariant I2 exactly. Applying the percentage to a line total instead would break it
 * whenever the discount lands on a half centavo.
 */
export function memberUnitPrice(priceCents: Cents, percent: number): Cents {
  return applyPercentageDiscount(priceCents, percent);
}

/** A line total. The only correct way to multiply a price by a quantity (invariant I2). */
export function lineTotal(unitPriceCents: Cents, quantity: number): Cents {
  assertCents(unitPriceCents, "unitPriceCents");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  const total = unitPriceCents * quantity;
  assertCents(total, "lineTotal");
  return total;
}

/** Sums centavos, checking the result stayed inside the safe integer range. */
export function sumCents(amounts: readonly Cents[]): Cents {
  let total = 0;
  for (const amount of amounts) {
    assertCents(amount, "amount");
    total += amount;
  }
  assertCents(total, "sum");
  return total;
}

/**
 * The order total, as invariant I1 defines it:
 *   total == subtotal + shipping + vat - discount
 *
 * Computing it in one place means a route handler cannot quietly invent a different
 * arrangement of the same four numbers.
 */
export function orderTotal(parts: {
  subtotalCents: Cents;
  shippingCents?: Cents;
  vatCents?: Cents;
  discountCents?: Cents;
}): Cents {
  const { subtotalCents, shippingCents = 0, vatCents = 0, discountCents = 0 } = parts;

  assertCents(subtotalCents, "subtotalCents");
  assertCents(shippingCents, "shippingCents");
  assertCents(vatCents, "vatCents");
  assertCents(discountCents, "discountCents");

  const total = subtotalCents + shippingCents + vatCents - discountCents;
  assertCents(total, "totalCents");
  return total;
}
