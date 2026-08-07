import { z } from "zod";

import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { reviewService } from "@/lib/services/review.service";

const bodySchema = z.object({ decision: z.enum(["approved", "rejected"]) });

/** Moderation. Nothing a customer wrote appears on the shop until this has been called. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const result = await reviewService.moderate(id, parsed.data.decision, { ...actor, id: actor.id });

  if (result.kind === "not_found") return fail("NOT_FOUND", "That review does not exist.");

  return ok({ ok: true, status: parsed.data.decision });
}
