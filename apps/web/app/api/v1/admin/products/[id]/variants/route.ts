import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { getProductForAdmin, productService } from "@/lib/services/product.service";
import { variantsSchema } from "@/lib/validators/product";

/**
 * Saves the whole variant matrix at once.
 *
 * The editor is a grid, so it posts the grid. Sending one request per cell would make a
 * partially-applied save the normal outcome of a flaky connection.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = variantsSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await productService.saveVariants(
    auditActor(guard.actor, request),
    id,
    parsed.data.variants
  );

  if (result.kind === "duplicate-sku") {
    // Names the offending SKUs. "Unique constraint failed on the fields: (`sku`)" tells a
    // shop admin nothing about which of twelve rows to fix.
    return fail("VALIDATION_ERROR", result.message, { duplicates: result.duplicates });
  }

  const product = await getProductForAdmin(id);
  return ok({ data: product });
}
