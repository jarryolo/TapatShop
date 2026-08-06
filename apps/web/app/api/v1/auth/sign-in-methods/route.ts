import { enforceRateLimit, failValidation, ok, readJson } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { normaliseEmail } from "@/lib/services/auth.service";
import { signInMethodsSchema } from "@/lib/validators/auth";

/**
 * Which sign-in methods an address uses, so the sign-in form can guide a Google-only
 * customer to the Google button instead of telling them their password is wrong.
 *
 * docs/07 requires that guidance. It necessarily confirms whether an address is registered,
 * which is an enumeration disclosure the forgot-password endpoint works hard to avoid.
 * That tension is real and the spec resolves it in favour of the customer who cannot
 * remember how they signed up. Two things keep the cost down:
 *
 *   - it is rate limited exactly like a login attempt
 *   - it reveals only *how* an account signs in, never whether the password is right
 *
 * If enumeration ever matters more than the guidance, this is the endpoint to delete.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = signInMethodsSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const limited = await enforceRateLimit(request, "signInMethods", parsed.data.email);
  if (limited) return limited;

  const email = normaliseEmail(parsed.data.email);
  const user = await db.user.findUnique({
    where: { email },
    select: { passwordHash: true, accounts: { select: { provider: true } } },
  });

  if (!user) {
    // Shaped like a real answer so the response body has the same fields either way.
    return ok({ exists: false, hasPassword: false, providers: [] });
  }

  return ok({
    exists: true,
    hasPassword: Boolean(user.passwordHash),
    providers: user.accounts.map((a) => a.provider),
  });
}
