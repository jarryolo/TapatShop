import { z } from "zod";

/**
 * Catalog query parameters.
 *
 * These arrive from a URL a customer can edit, so everything is coerced and bounded rather
 * than trusted. A negative page or a limit of 100000 is a typo or an attack, and neither
 * should reach a database query.
 */
export const catalogQuerySchema = z.object({
  category: z.string().trim().max(120).optional(),
  q: z.string().trim().max(200).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  inStock: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  sort: z.enum(["newest", "price_asc", "price_desc", "popular"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});

export type CatalogQueryInput = z.infer<typeof catalogQuerySchema>;

/**
 * Parses search params, discarding anything invalid rather than erroring.
 *
 * A page should not 500 because someone hand-edited `?page=abc`. Invalid values fall back to
 * the default, which is what a shopper expects to see.
 */
export function parseCatalogQuery(params: Record<string, string | undefined>): CatalogQueryInput {
  const result = catalogQuerySchema.safeParse(params);
  if (result.success) return result.data;

  // Keep whatever individual fields did parse.
  const salvaged: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    const single = catalogQuerySchema.safeParse({ [key]: value });
    if (single.success) salvaged[key] = value;
  }
  return catalogQuerySchema.parse(salvaged);
}
