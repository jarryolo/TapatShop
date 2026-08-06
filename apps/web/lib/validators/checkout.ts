import { z } from "zod";

/** Checkout payloads. Note what is absent: prices, totals, discounts. */

const phPhone = z
  .string()
  .trim()
  .regex(/^(\+?63|0)9\d{9}$/, "Enter a Philippine mobile number, like 09171234567.");

export const addressSchema = z.object({
  recipient: z.string().trim().min(1, "Who is receiving this?").max(120),
  phone: phPhone,
  region: z.string().trim().min(1, "Select a region."),
  province: z.string().trim().min(1, "Select a province."),
  city: z.string().trim().min(1, "Enter a city or municipality."),
  barangay: z.string().trim().min(1, "Enter a barangay."),
  street: z.string().trim().min(1, "Enter a house number and street.").max(300),
  postalCode: z.string().trim().max(10).optional().nullable(),
});

export const validateCheckoutSchema = z.object({
  address: addressSchema,
  shippingRateId: z.string().cuid().nullish(),
  /**
   * What the browser last displayed, used only to detect a change worth telling the customer
   * about. It is never used as a price — the server has already recomputed the real one.
   */
  seenSubtotalCents: z.number().int().min(0).optional(),
});

export const checkoutSessionSchema = z.object({
  address: addressSchema,
  shippingRateId: z.string().cuid(),
  // Required for guests, ignored for signed-in customers whose email we already hold.
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").optional(),
  name: z.string().trim().min(1).max(120).optional(),
  customerNote: z.string().trim().max(500).optional(),
});

export const couponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter a code.")
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Codes are letters, numbers, dashes and underscores."),
});
