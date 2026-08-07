import { auditActor, requireStaff } from "@/lib/api/guard";
import { failValidation, ok, readJson } from "@/lib/api/respond";
import { getProductForAdmin, productService } from "@/lib/services/product.service";
import { imageAltSchema, reorderImagesSchema } from "@/lib/validators/product";

/**
 * Image ordering and alt text.
 *
 * Uploading is not here — that needs the presigned S3 flow from P1-06, which needs MinIO.
 * Ordering and alt text work against whatever image rows already exist.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const body = await readJson(request);
  const actor = auditActor(guard.actor, request);

  const reorder = reorderImagesSchema.safeParse(body);
  if (reorder.success) {
    await productService.reorderImages(actor, id, reorder.data.imageIds);
    return ok({ data: await getProductForAdmin(id) });
  }

  const alt = imageAltSchema.safeParse(body);
  if (alt.success) {
    await productService.updateImageAlt(actor, alt.data.imageId, alt.data.alt);
    return ok({ data: await getProductForAdmin(id) });
  }

  return failValidation(reorder.error);
}
