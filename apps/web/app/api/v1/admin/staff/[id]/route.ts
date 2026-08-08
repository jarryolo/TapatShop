import { z } from "zod";

import { auditActor, requireAdmin } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { staffService } from "@/lib/services/staff.service";

const bodySchema = z.object({ role: z.enum(["customer", "staff", "admin"]) });

/**
 * Changes one account's role. Admin-only, audited, and it never touches a password.
 *
 * The refusals are the interesting part — each one is a way to lock every admin out of the
 * store, so they are answered with a message an admin can act on rather than a generic 400.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await staffService.changeRole(
    id,
    parsed.data.role,
    auditActor(guard.actor, request)
  );

  switch (result.kind) {
    case "not_found":
      return fail("NOT_FOUND", "That account does not exist.");
    case "self":
      return fail(
        "FORBIDDEN",
        "You cannot change your own role. Ask another admin to do it, so nobody can lock themselves out."
      );
    case "last_admin":
      return fail(
        "FORBIDDEN",
        "This is the only admin. Promote someone else to admin first, or nobody will be able to reach settings, staff, or the audit log."
      );
    case "unchanged":
      return ok({ ok: true, member: null, changed: false });
    default:
      return ok({ ok: true, member: result.member, changed: true });
  }
}
