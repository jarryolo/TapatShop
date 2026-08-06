import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { contentService } from "@/lib/services/content.service";
import { bannerPatchSchema } from "@/lib/validators/content";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bannerPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const result = await contentService.update(id, parsed.data, { ...actor, id: actor.id });

  if (result.kind === "not_found") return fail("NOT_FOUND", "That banner does not exist.");

  return ok({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const actor = auditActor(guard.actor, request);
  const result = await contentService.remove(id, { ...actor, id: actor.id });

  if (result.kind === "not_found") return fail("NOT_FOUND", "That banner does not exist.");

  return ok({ ok: true });
}
