import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { getProductForAdmin, productService } from "@/lib/services/product.service";
import { productPatchSchema } from "@/lib/validators/product";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const product = await getProductForAdmin(id);
  if (!product) return fail("NOT_FOUND", "That product does not exist.");

  // The editor needs to know what is stopping a publish before the admin tries it.
  const blockers = await productService.publishBlockers(id);
  return ok({ data: product, publishBlockers: blockers });
}

export async function PATCH(request: Request, context: Context) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = productPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const { status, ...fields } = parsed.data;
  const actor = auditActor(guard.actor, request);

  if (Object.keys(fields).length > 0) {
    await productService.update(actor, id, fields);
  }

  if (status === "active") {
    const result = await productService.publish(actor, id);
    if (result.kind === "blocked") {
      /**
       * 422 with every blocker at once.
       *
       * A product cannot go live without a variant, a price, a described image, and a
       * description — docs/05 and the P1-08 criteria. Returning them together means one
       * round trip instead of four.
       */
      return fail("VALIDATION_ERROR", "This product is not ready to publish yet.", {
        publishBlockers: result.problems,
      });
    }
  } else if (status) {
    await productService.setStatus(actor, id, status);
  }

  const product = await getProductForAdmin(id);
  return ok({ data: product });
}

export async function DELETE(request: Request, context: Context) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  /**
   * Archive rather than delete.
   *
   * Order items snapshot their product data, so a deleted product does not corrupt an old
   * invoice — but it does break the audit trail, the reorder flow, and every inventory
   * movement attached to its variants. Nothing here is expensive enough to keep to justify
   * that.
   */
  await productService.setStatus(auditActor(guard.actor, request), id, "archived");
  return ok({ ok: true, message: "Product archived." });
}
