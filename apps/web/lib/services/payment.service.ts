import type { Cents } from "@/lib/utils/money";

/**
 * The payment provider seam.
 *
 * PayMongo itself is P3-04 — it needs test keys and a webhook tunnel, neither of which
 * exists yet. This file defines the boundary so the checkout flow around it is complete and
 * testable, and so P3-04 is a matter of filling in one function rather than rewriting
 * checkout.
 */

export interface CheckoutSessionRequest {
  orderId: string;
  orderNo: string;
  totalCents: Cents;
  lines: { name: string; quantity: number; unitPriceCents: Cents }[];
  shippingCents: Cents;
  discountCents: Cents;
  customerEmail: string;
  baseUrl: string;
}

export type CheckoutSessionResult =
  | { kind: "ok"; checkoutUrl: string; providerSessionId: string; provider: string }
  | { kind: "not_configured"; message: string }
  | { kind: "failed"; message: string };

export function isPaymongoConfigured(): boolean {
  const key = process.env.PAYMONGO_SECRET_KEY;
  return typeof key === "string" && key.length > "sk_test_".length;
}

/**
 * Creates a hosted checkout session.
 *
 * In development with no PayMongo key, this returns a local stub URL so the rest of checkout
 * can be walked end to end. In production it refuses outright.
 *
 * That asymmetry is the entire point. A stub that silently worked in production would hand
 * out paid orders for free, so the guard is the first thing this function does and it fails
 * closed. When P3-04 lands, the real implementation replaces the stub branch and this guard
 * stays exactly as it is.
 */
export async function createCheckoutSession(
  request: CheckoutSessionRequest
): Promise<CheckoutSessionResult> {
  await Promise.resolve();

  if (isPaymongoConfigured()) {
    // P3-04 builds this: POST https://api.paymongo.com/v1/checkout_sessions, line items in
    // centavos summing exactly to totalCents, Idempotency-Key derived from the order id.
    return {
      kind: "not_configured",
      message: "PayMongo keys are set but the integration is not implemented yet (P3-04).",
    };
  }

  if (process.env.NODE_ENV === "production") {
    console.error("[payment] no PayMongo key in production; refusing to create a session");
    return {
      kind: "not_configured",
      message: "Payments are not available right now. Please try again shortly.",
    };
  }

  // Development only, and reachable only because both guards above declined.
  return {
    kind: "ok",
    provider: "stub",
    providerSessionId: `stub_${request.orderId}`,
    checkoutUrl: `${request.baseUrl}/checkout/stub-payment?orderNo=${encodeURIComponent(request.orderNo)}`,
  };
}
