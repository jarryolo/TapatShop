import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { authService } from "@/lib/services/auth.service";
import { resetPasswordSchema } from "@/lib/validators/auth";

export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  // Keyed by IP only — the token is the secret here, and keying by it would put a secret in
  // a Redis key name and in any log line that records it.
  const limited = await enforceRateLimit(request, "passwordReset");
  if (limited) return limited;

  const result = await authService.resetPassword(parsed.data.token, parsed.data.newPassword);

  switch (result.kind) {
    case "weak-password":
      return fail("VALIDATION_ERROR", result.message, {
        fields: { newPassword: result.message },
      });

    case "invalid-token":
      // One message for expired, already-used, and never-existed. Distinguishing them tells
      // an attacker holding a stale link whether it was ever real.
      return fail("VALIDATION_ERROR", "That reset link is no longer valid. Request a new one.");

    case "ok":
      return ok({
        ok: true,
        message: "Your password has been changed. You have been signed out everywhere.",
      });
  }
}
