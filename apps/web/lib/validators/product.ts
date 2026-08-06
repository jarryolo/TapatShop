import { z } from "zod";

/** Admin product and category payloads. Validated at the route boundary — docs/CLAUDE.md. */

/**
 * Money arrives as integer centavos and is validated as such at the edge.
 *
 * A float here would be silently truncated later and produce a price nobody typed, so it is
 * rejected outright rather than coerced.
 */
const cents = z
  .number()
  .int("Prices are in whole centavos — ₱1,234.50 is 123450.")
  .min(0, "A price cannot be negative.")
  .max(Number.MAX_SAFE_INTEGER);

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Give the product a name.").max(200),
  brand: z.string().trim().max(120).nullish(),
  categoryId: z.string().cuid().nullish(),
  description: z.string().trim().max(20_000).nullish(),
  isFeatured: z.boolean().optional(),
  memberOnly: z.boolean().optional(),
  metaTitle: z.string().trim().max(200).nullish(),
  metaDescription: z.string().trim().max(500).nullish(),
});

export const productPatchSchema = productInputSchema.partial().extend({
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export const variantSchema = z.object({
  id: z.string().cuid().optional(),
  sku: z
    .string()
    .trim()
    .min(1, "Every variant needs a SKU.")
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "SKUs can use letters, numbers, dots, dashes and underscores."),
  name: z.string().trim().min(1, "Name the variant. Use Default if there are no options.").max(120),
  priceCents: cents,
  compareAtPriceCents: cents.nullish(),
  costCents: cents.nullish(),
  lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
  optionValues: z.record(z.string(), z.string()).nullish(),
});

export const variantsSchema = z.object({
  variants: z.array(variantSchema).min(1, "Add at least one variant.").max(200),
});

export const reorderImagesSchema = z.object({
  imageIds: z.array(z.string().cuid()).max(50),
});

export const imageAltSchema = z.object({
  imageId: z.string().cuid(),
  alt: z.string().trim().max(300),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(120),
  parentId: z.string().cuid().nullish(),
  description: z.string().trim().max(2000).nullish(),
  imageUrl: z.string().url().nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});
