import { z } from "zod";

import { auditActor, requireStaff } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { getOrderForAdmin } from "@/lib/services/admin-orders.service";
import { IllegalTransitionError, transitionOrder } from "@/lib/services/order.service";

const bodySchema = z.object({
  status: z.enum(["pending", "confirmed", "cancelled", "completed"]).optional(),
  paymentStatus: z
    .enum(["unpaid", "awaiting_payment", "paid", "partially_refunded", "refunded", "failed"])
    .optional(),
  fulfillmentStatus: z
    .enum(["unfulfilled", "packed", "shipped", "delivered", "returned"])
    .optional(),
  cancelReason: z.string().trim().max(300).optional(),
});

/**
 * Moves an order. Validated against the state machine — docs/03.
 *
 * The UI only offers legal transitions, but this re-checks anyway: the UI is a convenience,
 * and a hand-crafted request must not be able to put an order in an impossible state.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);

  try {
    await db.$transaction((tx) =>
      transitionOrder(tx, id, {
        ...parsed.data,
        actorId: actor.id,
        ip: actor.ip,
        userAgent: actor.userAgent,
      })
    );
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      // Names the axis and both states, so the message is actionable rather than "invalid".
      return fail("VALIDATION_ERROR", error.message, {
        axis: error.axis,
        from: error.from,
        to: error.to,
      });
    }
    if (error instanceof Error && /reason/i.test(error.message)) {
      return fail("VALIDATION_ERROR", "Cancelling an order needs a reason.");
    }
    throw error;
  }

  return ok({ data: await getOrderForAdmin(db, id) });
}
