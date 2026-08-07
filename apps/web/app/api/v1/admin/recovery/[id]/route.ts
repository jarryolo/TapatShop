import { z } from "zod";

import { auditActor, requireAdmin } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { customerService } from "@/lib/services/customer.service";

/**
 * The note is required either way, not just on a rejection.
 *
 * An approval with no stated evidence is exactly what this whole flow exists to prevent —
 * "who approved this and what did they check" has to be answerable a year later, and it is
 * only answerable if the answer was written down at the time.
 */
const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().min(1, "Say what you checked.").max(500),
});

/** The evidence an admin weighs before deciding — docs/07 wants two matching data points. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const evidence = await customerService.evidence(id);
  if (!evidence) return fail("NOT_FOUND", "That recovery request does not exist.");

  return ok({ data: evidence });
}

/**
 * Approves or rejects. **Admin only** — docs/04 puts recovery in the admin-only column.
 *
 * Approving sends a confirmation link to the new address and does nothing else. It cannot
 * set a password, and there is no route in this codebase that lets an admin do so.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);

  if (parsed.data.action === "reject") {
    const rejected = await customerService.reject(id, {
      actorId: actor.id,
      note: parsed.data.note,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    if (!rejected) return fail("NOT_FOUND", "That request is not pending.");
    return ok({ ok: true, status: "rejected" });
  }

  const result = await customerService.approve(id, {
    actorId: actor.id,
    note: parsed.data.note,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  switch (result.kind) {
    case "not_found":
      return fail("NOT_FOUND", "That recovery request does not exist.");
    case "already_handled":
      return fail("VALIDATION_ERROR", "That request has already been decided.");
    case "no_user_matched":
      return fail(
        "VALIDATION_ERROR",
        "No account is linked to this request yet. Match it to a customer first."
      );
    case "ok":
      return ok({
        ok: true,
        status: "approved",
        message: "A confirmation link has been sent to the new address.",
      });
  }
}
