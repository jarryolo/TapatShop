import { z } from "zod";

import { auth } from "@/lib/auth";
import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { stockAlertService } from "@/lib/services/stock-alert.service";

const bodySchema = z.object({
  variantId: z.string().cuid(),
  email: z.string().trim().toLowerCase().email("Enter an email we can reach you at."),
});

/**
 * "Tell me when this is back."
 *
 * Open to guests on purpose. The person most likely to want this is the one who just found the
 * thing out of stock, and making them register first loses the sale we are trying to recover.
 * A signed-in customer's address is taken from their account rather than the request body.
 */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const { slug } = await context.params;
  const session = await auth();

  // The variant has to belong to the product in the URL, or this becomes a way to subscribe
  // to anything by guessing ids.
  const variant = await db.productVariant.findFirst({
    where: { id: parsed.data.variantId, product: { slug, status: "active" } },
    select: { id: true },
  });
  if (!variant) return fail("NOT_FOUND", "That item does not exist.");

  const email = session?.user?.email ?? parsed.data.email;
  const result = await stockAlertService.subscribe(variant.id, email, session?.user?.id ?? null);

  switch (result.kind) {
    case "not_found":
      return fail("NOT_FOUND", "That item does not exist.");
    case "in_stock":
      return fail("VALIDATION_ERROR", "Good news — that is back in stock now.");
    case "ok":
      return ok({ ok: true, message: "We will email you when it is back." });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string }> }) {
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const { slug } = await context.params;
  const session = await auth();

  const variant = await db.productVariant.findFirst({
    where: { id: parsed.data.variantId, product: { slug } },
    select: { id: true },
  });
  if (!variant) return fail("NOT_FOUND", "That item does not exist.");

  await stockAlertService.unsubscribe(variant.id, session?.user?.email ?? parsed.data.email);

  return ok({ ok: true });
}
