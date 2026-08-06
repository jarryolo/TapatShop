import { enforceRateLimit, failValidation, ok, readJson } from "@/lib/api/respond";
import { authService } from "@/lib/services/auth.service";
import { forgotPasswordSchema } from "@/lib/validators/auth";

/**
 * Always returns the same 200, whatever happened. docs/07: preventing account enumeration is
 * the entire point of this endpoint's design.
 *
 * That includes the failure paths. An unhandled error here must not produce a 500 for
 * registered addresses and a 200 for everything else — the difference would be the leak.
 */
const SAME_ANSWER = {
  ok: true,
  message: "If that email has an account, we have sent a link to reset the password.",
};

export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const limited = await enforceRateLimit(request, "passwordReset", parsed.data.email);
  if (limited) return limited;

  try {
    await authService.requestPasswordReset(parsed.data.email);
  } catch (error) {
    console.error("[auth] password reset request failed", error);
  }

  return ok(SAME_ANSWER);
}
