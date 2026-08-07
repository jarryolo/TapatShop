import { requireStaff } from "@/lib/api/guard";
import { ok } from "@/lib/api/respond";
import { inventoryService } from "@/lib/services/inventory.service";

/** Per-SKU movement history: actor, delta, reason, and running balance — P4-03. */
export async function GET(request: Request, context: { params: Promise<{ variantId: string }> }) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const { variantId } = await context.params;
  return ok({ data: await inventoryService.movements(variantId) });
}
