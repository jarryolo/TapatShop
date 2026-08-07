import { z } from "zod";

import { auditActor, requireAdmin } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { settingsService } from "@/lib/services/settings.service";

const bodySchema = z.object({ value: z.union([z.string(), z.number(), z.boolean()]) });

/**
 * Writes one setting. **Admin only** — docs/04 puts settings in the admin-only column.
 *
 * There is deliberately no GET for a single key. The list endpoint masks secrets, and a
 * per-key read would be the obvious place for that masking to be forgotten.
 */
export async function PUT(request: Request, context: { params: Promise<{ key: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const { key } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const result = await settingsService.save(key, parsed.data.value, { ...actor, id: actor.id });

  switch (result.kind) {
    case "unknown_key":
      // Named settings only: a typo must not silently create a setting nothing reads.
      return fail("NOT_FOUND", "There is no such setting.");
    case "invalid":
      return fail("VALIDATION_ERROR", result.message);
    case "ok":
      return ok({ ok: true });
  }
}
