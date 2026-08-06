import { z } from "zod";

import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { getOrderForAdmin } from "@/lib/services/admin-orders.service";
import { IllegalTransitionError, addTracking } from "@/lib/services/order.service";

const bodySchema = z.object({
  carrier: z.string().trim().min(1, "Which courier?").max(80),
  trackingNumber: z.string().trim().min(1, "Enter the tracking number.").max(80),
});

/** Records tracking, ships the order, and triggers the shipped email exactly once — P4-01. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);

  try {
    await db.$transaction((tx) =>
      addTracking(tx, id, {
        carrier: parsed.data.carrier,
        trackingNumber: parsed.data.trackingNumber,
        actorId: actor.id,
        ip: actor.ip,
        userAgent: actor.userAgent,
      })
    );
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      return fail(
        "VALIDATION_ERROR",
        "This order cannot be shipped from its current state. Pack it first."
      );
    }
    throw error;
  }

  return ok({ data: await getOrderForAdmin(db, id) });
}
