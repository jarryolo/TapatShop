import { z } from "zod";

import { auditActor, requireAdmin } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { privacyService } from "@/lib/services/privacy.service";

const bodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("complete") }),
  z.object({
    decision: z.literal("refuse"),
    // Refusing a legal right needs a stated reason, always.
    reason: z.string().trim().min(1, "Say why the request is being refused.").max(1000),
  }),
]);

/**
 * Carries out or refuses an erasure. **Admin only**, not staff.
 *
 * This is irreversible and it touches order records. Staff handle orders and inventory —
 * docs/01 — and nothing in that job needs the ability to erase a customer.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);

  if (parsed.data.decision === "refuse") {
    const result = await privacyService.refuse(id, parsed.data.reason, {
      ...actor,
      id: actor.id,
    });
    if (result.kind === "not_found") return fail("NOT_FOUND", "That request does not exist.");
    if (result.kind === "already_handled") {
      return fail("VALIDATION_ERROR", "That request has already been decided.");
    }
    return ok({ ok: true, status: "refused" });
  }

  const result = await privacyService.complete(id, { ...actor, id: actor.id });

  switch (result.kind) {
    case "not_found":
      return fail("NOT_FOUND", "That request does not exist.");
    case "already_handled":
      return fail("VALIDATION_ERROR", "That request has already been decided.");
    case "is_staff":
      return fail(
        "VALIDATION_ERROR",
        "Staff and admin accounts cannot be erased here — their id is referenced by every audit entry they wrote."
      );
    case "ok":
      return ok({
        ok: true,
        status: "completed",
        message: `Erased. ${result.ordersScrubbed} ${result.ordersScrubbed === 1 ? "order" : "orders"} kept with personal details removed.`,
      });
  }
}
