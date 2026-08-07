import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { couponService } from "@/lib/services/coupon.service";
import { couponInputSchema } from "@/lib/validators/coupon";

export async function GET(request: Request) {
  // Re-checked here, not just in middleware. docs/02: middleware is a convenience.
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  return ok({ data: await couponService.list() });
}

export async function POST(request: Request) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const parsed = couponInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const result = await couponService.create(parsed.data, { ...actor, id: actor.id });

  if (result.kind === "code_taken") {
    return fail("VALIDATION_ERROR", "That code already exists. Pick another.");
  }
  if (result.kind === "not_found") {
    return fail("NOT_FOUND", "That coupon does not exist.");
  }

  return ok({ data: { id: result.id } }, 201);
}
