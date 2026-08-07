import { z } from "zod";

import { requireStaff } from "@/lib/api/guard";
import { failValidation, ok } from "@/lib/api/respond";
import { adminOrders } from "@/lib/services/admin-orders.service";

const filterSchema = z.object({
  status: z.enum(["pending", "confirmed", "cancelled", "completed"]).optional(),
  paymentStatus: z
    .enum(["unpaid", "awaiting_payment", "paid", "partially_refunded", "refunded", "failed"])
    .optional(),
  fulfillmentStatus: z
    .enum(["unfulfilled", "packed", "shipped", "delivered", "returned"])
    .optional(),
  q: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = filterSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return failValidation(parsed.error);

  return ok(await adminOrders.list(parsed.data));
}
