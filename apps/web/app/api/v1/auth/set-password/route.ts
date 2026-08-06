import { requireUser } from "@/lib/api/guard";
import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { authService } from "@/lib/services/auth.service";
import { setPasswordSchema } from "@/lib/validators/auth";

/**
 * Adds a password to a Google-only account.
 *
 * docs/07 treats this as a credential change rather than a profile edit. requireUser()
 * already rejects a session issued before a revocation, which is the check that matters
 * here: a stolen token from before a reset must not be able to set a new password.
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  const parsed = setPasswordSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const limited = await enforceRateLimit(request, "passwordReset", guard.actor.id);
  if (limited) return limited;

  const result = await authService.setPassword(guard.actor.id, parsed.data.password);

  switch (result.kind) {
    case "weak-password":
      return fail("VALIDATION_ERROR", result.message, { fields: { password: result.message } });

    case "already-has-password":
      return fail(
        "FORBIDDEN",
        "This account already has a password. Use the change password form instead."
      );

    case "ok":
      return ok({ ok: true, message: "Password set. You can now sign in with your email." });
  }
}
