import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";
import { isKnownRegion, regionForProvince } from "@/lib/data/ph-locations";
import type { Cents } from "@/lib/utils/money";

/**
 * Shipping zones and rates. See docs/03 for the seeded zones.
 *
 * The customer must see the exact shipping fee before being asked to pay — docs/01. So this
 * returns a concrete peso figure for a concrete address and basket, never a range.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export interface QuoteRequest {
  /** A region code such as "NCR" or "Region VII". */
  regionCode: string;
  subtotalCents: Cents;
  weightGrams: number;
}

export interface ShippingOption {
  rateId: string;
  zoneName: string;
  name: string;
  /** What the customer pays. Zero when the free-shipping threshold is met. */
  feeCents: Cents;
  /** What it would have cost, when free shipping applied. */
  originalFeeCents: Cents | null;
  freeAboveCents: Cents | null;
  etaDaysMin: number;
  etaDaysMax: number;
  /** How much more they would need to spend for free shipping, when it is within reach. */
  spendMoreForFreeCents: Cents | null;
}

export type QuoteResult =
  { kind: "ok"; options: ShippingOption[] } | { kind: "unknown_region" } | { kind: "no_service" };

/**
 * Billable weight in whole kilograms.
 *
 * Couriers round up: 1,001g is two kilos. Rounding down would mean quoting less than the
 * courier charges on every parcel that is a gram over, and eating the difference.
 */
export function billableKilos(weightGrams: number): number {
  if (weightGrams <= 0) return 0;
  return Math.ceil(weightGrams / 1000);
}

/**
 * The fee for one rate.
 *
 * `baseCents` covers the first kilogram; `perKgCents` applies to each one after it. A parcel
 * under a kilo pays the base and nothing more.
 */
export function rateFee(
  rate: { baseCents: number; perKgCents: number },
  weightGrams: number
): Cents {
  const kilos = billableKilos(weightGrams);
  const extraKilos = Math.max(0, kilos - 1);
  return rate.baseCents + extraKilos * rate.perKgCents;
}

/**
 * Whether free shipping applies.
 *
 * At or above the threshold, not merely above it. A ₱2,500 threshold that does not trigger
 * on a ₱2,500 order is the kind of off-by-one a customer notices immediately and reads as
 * dishonest — and the build plan asks for the boundary case specifically.
 */
export function qualifiesForFreeShipping(
  subtotalCents: Cents,
  freeAboveCents: number | null
): boolean {
  if (freeAboveCents === null) return false;
  return subtotalCents >= freeAboveCents;
}

/** The zone serving a region, or null when nothing covers it. */
export async function zoneForRegion(tx: Db, regionCode: string) {
  const zones = await tx.shippingZone.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: { rates: { where: { isActive: true }, orderBy: { baseCents: "asc" } } },
  });

  return (
    zones.find((zone) => {
      const regions = Array.isArray(zone.regions) ? (zone.regions as unknown[]) : [];
      return regions.some((region) => String(region) === regionCode);
    }) ?? null
  );
}

/** Every rate available for an address, priced for this basket. */
export async function quote(tx: Db, request: QuoteRequest): Promise<QuoteResult> {
  if (!isKnownRegion(request.regionCode)) return { kind: "unknown_region" };

  const zone = await zoneForRegion(tx, request.regionCode);
  // A region with no zone is a configuration gap, not a customer error — the checkout should
  // say "we do not ship there yet" rather than quietly charging zero.
  if (!zone || zone.rates.length === 0) return { kind: "no_service" };

  const options: ShippingOption[] = zone.rates.map((rate) => {
    const fee = rateFee(rate, request.weightGrams);
    const free = qualifiesForFreeShipping(request.subtotalCents, rate.freeAboveCents);
    const shortfall =
      !free && rate.freeAboveCents !== null ? rate.freeAboveCents - request.subtotalCents : null;

    return {
      rateId: rate.id,
      zoneName: zone.name,
      name: rate.name,
      feeCents: free ? 0 : fee,
      originalFeeCents: free ? fee : null,
      freeAboveCents: rate.freeAboveCents,
      etaDaysMin: rate.etaDaysMin,
      etaDaysMax: rate.etaDaysMax,
      spendMoreForFreeCents: shortfall !== null && shortfall > 0 ? shortfall : null,
    };
  });

  return { kind: "ok", options };
}

/** Convenience for a stored address, which records a province rather than a region code. */
export async function quoteForProvince(
  tx: Db,
  province: string,
  subtotalCents: Cents,
  weightGrams: number
): Promise<QuoteResult> {
  const regionCode = regionForProvince(province);
  if (!regionCode) return { kind: "unknown_region" };
  return quote(tx, { regionCode, subtotalCents, weightGrams });
}

/**
 * The total shipping weight of a basket.
 *
 * Packaging is not modelled. Every seeded variant carries a weight, and a variant with none
 * contributes zero rather than blocking the quote — an unpriced parcel is better than an
 * unbuyable one, and the admin sees the zero in the product editor.
 */
export function basketWeightGrams(lines: { weightGrams: number; quantity: number }[]): number {
  return lines.reduce((total, line) => total + line.weightGrams * line.quantity, 0);
}

export const shippingService = {
  quote: (request: QuoteRequest) => quote(db, request),
  quoteForProvince: (province: string, subtotalCents: Cents, weightGrams: number) =>
    quoteForProvince(db, province, subtotalCents, weightGrams),
  zoneForRegion: (regionCode: string) => zoneForRegion(db, regionCode),
};
