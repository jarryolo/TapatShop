import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { authService } from "@/lib/services/auth.service";
import { registerSchema } from "@/lib/validators/auth";

export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const limited = await enforceRateLimit(request, "register", parsed.data.email);
  if (limited) return limited;

  const result = await authService.register(parsed.data);

  switch (result.kind) {
    case "weak-password":
      return fail("VALIDATION_ERROR", result.message, { fields: { password: result.message } });

    case "privacy-not-agreed":
      return fail("VALIDATION_ERROR", "You need to agree to the privacy policy to continue.");

    case "email-taken":
      /**
       * Deliberately indistinguishable from success.
       *
       * Saying "that email is already registered" turns this endpoint into a membership
       * oracle for the whole customer list. The address owner learns the truth from the
       * email they receive; a stranger learns nothing. The trade is that someone who
       * genuinely forgot they had an account gets a slightly confusing silence — which is
       * what the "already have an account?" link on the form is for.
       */
      return ok({ ok: true, message: "Check your email to finish setting up your account." }, 201);

    case "ok":
      return ok({ ok: true, message: "Check your email to finish setting up your account." }, 201);
  }
}
