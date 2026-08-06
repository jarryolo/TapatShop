import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { authService } from "@/lib/services/auth.service";
import { verifyEmailSchema } from "@/lib/validators/auth";

export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const verified = await authService.verifyEmail(parsed.data.token);
  if (!verified) {
    return fail("VALIDATION_ERROR", "That verification link is no longer valid.");
  }

  return ok({ ok: true, message: "Your email is verified." });
}
