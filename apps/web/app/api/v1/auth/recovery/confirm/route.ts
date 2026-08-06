import { z } from "zod";

import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { customerService } from "@/lib/services/customer.service";

const bodySchema = z.object({ token: z.string().min(1) });

/**
 * The customer completes their own recovery â€” docs/07 route 3, step 3.
 *
 * Moves the login email, revokes every existing session, and notifies both addresses. It
 * does NOT set a password: the customer uses forgot-password against their new address
 * afterwards, which is a flow only they can complete.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "accountRecovery");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await customerService.confirm(parsed.data.token);

  if (result.kind === "invalid") {
    // One message for expired, already-used and never-existed.
    return fail("VALIDATION_ERROR", "That link is no longer valid. Ask an admin to re-send it.");
  }

  return ok({
    ok: true,
    message:
      "Your sign-in email has been changed. Use 'forgot password' with your new address to set a password.",
  });
}
