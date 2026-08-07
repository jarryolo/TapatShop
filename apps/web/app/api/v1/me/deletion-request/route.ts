import { z } from "zod";

import { requireUser } from "@/lib/api/guard";
import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { privacyService } from "@/lib/services/privacy.service";

const bodySchema = z.object({ reason: z.string().trim().max(2000).optional() });

/**
 * A Data Privacy Act erasure request — docs/04 `POST /me/deletion-request`.
 *
 * A request rather than an immediate delete. Someone with an order in transit needs it
 * delivered, and an account that erases itself the moment a stolen session asks would be a
 * weapon rather than a right.
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await privacyService.request(guard.actor.id, parsed.data.reason ?? null);

  switch (result.kind) {
    case "not_found":
      return fail("NOT_FOUND", "That account does not exist.");
    case "already_pending":
      return fail("VALIDATION_ERROR", "You already have a request waiting. We will be in touch.");
    case "ok":
      return ok(
        {
          ok: true,
          message:
            "Your request has been received. We will confirm by email once it has been carried out.",
        },
        201
      );
  }
}
