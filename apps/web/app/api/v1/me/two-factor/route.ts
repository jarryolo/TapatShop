import { z } from "zod";

import { requireUser } from "@/lib/api/guard";
import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { twoFactorService } from "@/lib/services/two-factor.service";

const confirmSchema = z.object({
  code: z.string().trim().min(1, "Enter the code from your authenticator app.").max(20),
});

/** Whether it is on, whether it is required, and how many recovery codes are left. */
export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const limited = await enforceRateLimit(request, "default", guard.actor.id);
  if (limited) return limited;

  return ok({ data: await twoFactorService.status(guard.actor.id) });
}

/**
 * Begins enrolment and returns the secret to scan.
 *
 * Nothing is enforced until POST /confirm proves the app works, so this is safe to call again
 * — a fresh secret each time is what someone who mis-scanned needs.
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const limited = await enforceRateLimit(request, "otpRequest", guard.actor.id);
  if (limited) return limited;

  const started = await twoFactorService.start(guard.actor.id);

  if ("kind" in started) {
    return fail("VALIDATION_ERROR", "Two-factor is already on. Reset it if you have a new phone.");
  }

  return ok({ data: started });
}

/**
 * Confirms enrolment with a code and returns the recovery codes.
 *
 * This response is the only time the recovery codes exist in readable form — they are stored
 * hashed, so there is no second chance to show them.
 */
export async function PUT(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  // Same limit as OTP verification: this accepts a guessable six-digit code.
  const limited = await enforceRateLimit(request, "otpVerify", guard.actor.id);
  if (limited) return limited;

  const parsed = confirmSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await twoFactorService.confirm(guard.actor.id, parsed.data.code);

  switch (result.kind) {
    case "no_enrolment":
      return fail("VALIDATION_ERROR", "Start setting up two-factor first.");
    case "bad_code":
      return fail("VALIDATION_ERROR", "That code is not right. Try the current one.");
    case "ok":
      return ok({
        data: { recoveryCodes: result.recoveryCodes },
        message: "Two-factor is on. Save these codes somewhere safe — they are shown once.",
      });
  }
}
