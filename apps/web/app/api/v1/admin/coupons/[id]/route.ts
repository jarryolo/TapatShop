import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { couponService } from "@/lib/services/coupon.service";
import { couponPatchSchema } from "@/lib/validators/coupon";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = couponPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const result = await couponService.update(id, parsed.data, { ...actor, id: actor.id });

  if (result.kind === "code_taken") {
    return fail("VALIDATION_ERROR", "That code already exists. Pick another.");
  }
  if (result.kind === "not_found") {
    return fail("NOT_FOUND", "That coupon does not exist.");
  }

  return ok({ data: { id: result.id } });
}

/**
 * Retires a coupon.
 *
 * Deletes it outright only if it was never used. A used coupon is deactivated instead — its
 * redemption rows are the record of what it gave away, and the schema cascades, so deleting
 * would take the history with it.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const actor = auditActor(guard.actor, request);
  const result = await couponService.deactivate(id, { ...actor, id: actor.id });

  if (result.kind === "not_found") return fail("NOT_FOUND", "That coupon does not exist.");

  return ok({ ok: true });
}
