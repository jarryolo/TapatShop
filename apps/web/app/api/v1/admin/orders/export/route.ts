import { z } from "zod";

import { requireStaff } from "@/lib/api/guard";
import { failValidation } from "@/lib/api/respond";
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
});

/** CSV export of the current filter — docs/04. */
export async function GET(request: Request) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = filterSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return failValidation(parsed.error);

  const csv = await adminOrders.exportCsv(parsed.data);
  const stamp = new Date().toISOString().slice(0, 10);

  // A byte order mark, written as an escape rather than an invisible literal. Without it
  // Excel opens the file in the system codepage and every peso sign becomes mojibake.
  const BOM = "\uFEFF";

  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tapatshop-orders-${stamp}.csv"`,
      // Never cached: it contains customer names and addresses.
      "Cache-Control": "no-store",
    },
  });
}
