import { z } from "zod";

import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { MANUAL_REASONS, inventoryService } from "@/lib/services/inventory.service";

const bodySchema = z.object({
  variantId: z.string().cuid(),
  delta: z
    .number()
    .int("Adjustments are whole units.")
    .refine((value) => value !== 0, "Enter how many units to add or remove."),
  reason: z.enum(MANUAL_REASONS),
  // Mandatory at the boundary as well as in the service — P4-03 and docs/01 both require it,
  // and "stockQty is 3 and nobody knows why" is the failure being prevented.
  note: z.string().trim().min(1, "Say why the stock is changing."),
});

export async function POST(request: Request) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const result = await inventoryService.adjust({ ...parsed.data, ...actor, actorId: actor.id });

  switch (result.kind) {
    case "no_reason":
      return fail("VALIDATION_ERROR", "Say why the stock is changing.", {
        fields: { note: "Say why the stock is changing." },
      });

    case "zero_delta":
      return fail("VALIDATION_ERROR", "Enter how many units to add or remove.");

    case "not_found":
      return fail("NOT_FOUND", "That variant does not exist.");

    case "would_go_negative":
      return fail(
        "VALIDATION_ERROR",
        `That would take stock below zero. There are ${result.stockQty} on hand.`
      );

    case "ok":
      return ok({ data: { balanceAfter: result.balanceAfter, movementId: result.movementId } });
  }
}
