import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { readCartContext } from "@/lib/cart-session";
import { db } from "@/lib/db";
import { findCartId } from "@/lib/services/cart.service";
import { checkoutService } from "@/lib/services/checkout.service";
import { createCheckoutSession } from "@/lib/services/payment.service";
import { releaseForOrder } from "@/lib/services/reservation.service";
import { checkoutSessionSchema } from "@/lib/validators/checkout";

/**
 * The most important endpoint in the system — docs/04.
 *
 * Reserves stock, creates the order, then calls the payment provider. If that call fails the
 * reservation is released and the order marked failed, so a provider outage does not leave
 * stock held for fifteen minutes behind an order nobody can pay for.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "checkoutSession");
  if (limited) return limited;

  const parsed = checkoutSessionSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const context = await readCartContext(request);
  const cartId = await findCartId(db, context.identity);
  if (!cartId) return fail("NOT_FOUND", "Your cart is empty.");

  // A signed-in customer's details come from their account, not the request body.
  let email = parsed.data.email ?? "";
  let name = parsed.data.name ?? parsed.data.address.recipient;

  if (context.identity.userId) {
    const user = await db.user.findUnique({
      where: { id: context.identity.userId },
      select: { email: true, name: true },
    });
    if (user) {
      email = user.email;
      name = user.name;
    }
  }

  if (!email) {
    return fail("VALIDATION_ERROR", "Enter an email address so we can send your receipt.", {
      fields: { email: "Enter an email address." },
    });
  }

  const started = await checkoutService.start(
    cartId,
    {
      userId: context.identity.userId,
      email,
      name,
      phone: parsed.data.address.phone,
      isMember: context.isMember,
      memberPercent: context.memberPercent,
    },
    parsed.data.address,
    parsed.data.shippingRateId
  );

  switch (started.kind) {
    case "empty_cart":
      return fail("NOT_FOUND", "Your cart is empty.");
    case "no_service":
      return fail("NOT_FOUND", "We do not ship to that region yet.");
    case "unavailable_lines":
      return fail("CART_STALE", "Some items are no longer available.", {
        changes: started.changes,
      });
    case "out_of_stock":
      // Someone else took the stock between the cart page and here. Before payment, as
      // docs/01 requires — never after.
      return fail("OUT_OF_STOCK", "Someone else just took the last of an item in your cart.", {
        changes: started.changes,
      });
    case "ok":
      break;
  }

  const order = await db.order.findUniqueOrThrow({
    where: { id: started.orderId },
    include: { items: true },
  });

  const session = await createCheckoutSession({
    orderId: order.id,
    orderNo: order.orderNo,
    totalCents: order.totalCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    customerEmail: order.customerEmail,
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? new URL(request.url).origin,
    lines: order.items.map((item) => ({
      name: `${item.productName} — ${item.variantName}`,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
  });

  if (session.kind !== "ok") {
    /**
     * Roll the whole thing back.
     *
     * docs/06: on a provider failure, release the reservations, mark the order failed, and
     * return PAYMENT_FAILED. Leaving the reservation in place would hold stock for fifteen
     * minutes against an order that can never be paid.
     */
    await db.$transaction(async (tx) => {
      await releaseForOrder(tx, order.id);
      await tx.order.update({
        where: { id: order.id },
        data: { status: "cancelled", paymentStatus: "failed", cancelledAt: new Date() },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "payment_failed",
          message: "Could not start a payment session.",
          isPublic: false,
        },
      });
    });

    return fail("PAYMENT_FAILED", session.message);
  }

  await db.payment.create({
    data: {
      orderId: order.id,
      provider: session.provider,
      checkoutSessionId: session.providerSessionId,
      amountCents: order.totalCents,
      status: "pending",
    },
  });

  return ok({ orderNo: order.orderNo, checkoutUrl: session.checkoutUrl });
}
