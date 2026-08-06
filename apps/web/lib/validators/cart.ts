import { z } from "zod";

/** Cart payloads. docs/04: the browser sends variant ids and quantities, nothing more. */

export const addItemSchema = z.object({
  variantId: z.string().cuid(),
  // Bounded so a typo cannot ask for a million. The real limit is stock, applied server-side.
  quantity: z.number().int().min(1).max(999).default(1),
});

export const updateItemSchema = z.object({
  // Zero removes the line — docs/04.
  quantity: z.number().int().min(0).max(999),
});
