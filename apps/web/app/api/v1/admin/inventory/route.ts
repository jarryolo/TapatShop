import { z } from "zod";

import { requireStaff } from "@/lib/api/guard";
import { failValidation, ok } from "@/lib/api/respond";
import { inventoryService } from "@/lib/services/inventory.service";

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  lowStock: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  outOfStock: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

/** `?lowStock=true` — docs/04. */
export async function GET(request: Request) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return failValidation(parsed.error);

  const rows = await inventoryService.list({
    q: parsed.data.q,
    lowStockOnly: parsed.data.lowStock,
    outOfStockOnly: parsed.data.outOfStock,
  });

  return ok({ data: rows });
}
