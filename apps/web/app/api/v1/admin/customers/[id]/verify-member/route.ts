import { z } from "zod";

import { auditActor, requireAdmin } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { customerService } from "@/lib/services/customer.service";

const bodySchema = z.object({
  memberNo: z.string().trim().min(1, "Enter the member number.").max(40),
  chapter: z.string().trim().min(1, "Which chapter?").max(80),
});

/**
 * Verifies a member. **Admin only**, not staff — docs/01 and docs/04.
 *
 * Member status grants a store-wide discount, so it is a money decision, not an operational
 * one. requireAdmin rather than requireStaff is the whole point of this route.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const result = await customerService.verifyMember(id, {
    ...parsed.data,
    ...actor,
    actorId: actor.id,
  });

  switch (result.kind) {
    case "not_found":
      return fail("NOT_FOUND", "That customer does not exist.");
    case "member_no_taken":
      return fail("VALIDATION_ERROR", "That member number is already on another account.");
    case "ok":
      return ok({ ok: true });
  }
}

/** Withdraws verification. Also admin only, also audited. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const actor = auditActor(guard.actor, request);
  await customerService.revokeMember(id, { ...actor, actorId: actor.id });

  return ok({ ok: true });
}
