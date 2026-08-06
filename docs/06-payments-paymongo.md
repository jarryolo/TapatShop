# 06 — Payments (PayMongo)

Use the **Checkout Sessions API** — PayMongo's hosted checkout page. Do not build a card
form. Hosted checkout keeps card data entirely off our servers and removes most PCI scope.

Docs: https://developers.paymongo.com/docs/checkout-api

## Payment methods to enable

GCash, Maya, GrabPay, QRPh, online banking (BPI, UnionBank), and cards. GCash and Maya
will carry most of the volume in the Philippines — they must be enabled from day one.

## Fees (verify against PayMongo's current pricing page before launch)

Standard published rates are roughly 3% + ₱15 on cards and 2.5% on e-wallets and online
banking, with lower rates on QRPh and direct online banking, and custom rates available at
higher volume. Non-Philippine issued cards carry an additional 1% cross-border fee. All
PayMongo fees are VAT-inclusive.

Two consequences for the build:
1. Store `feeCents` and `netCents` on `Payment` when the webhook provides them, so
   reconciliation and margin reporting are possible later.
2. The business must decide whether to absorb fees or pass them on. This is a `Setting`,
   not a hardcoded value.

## Happy path

```
1. Customer clicks "Place order"
2. POST /api/v1/checkout/session
   ├─ Re-price the entire cart from the database. Ignore all client totals.
   ├─ Validate coupon eligibility server-side
   ├─ Compute shipping from the zone rules
   ├─ BEGIN TRANSACTION
   │   ├─ SELECT ... FOR UPDATE on each variant
   │   ├─ Check stockQty − active reservations >= quantity
   │   ├─ Insert StockReservation rows (+ Redis keys, TTL 900s)
   │   ├─ Create Order (status=pending, paymentStatus=awaiting_payment)
   │   └─ Create OrderItem snapshots
   ├─ COMMIT
   ├─ Call PayMongo: create checkout session
   │   └─ On failure: release reservations, mark order failed, return PAYMENT_FAILED
   ├─ Store checkoutSessionId on a Payment row
   └─ Return { orderNo, checkoutUrl }
3. Redirect the browser to checkoutUrl
4. Customer pays on PayMongo's page
5. PayMongo POSTs checkout_session.payment.paid → /api/v1/webhooks/paymongo
   └─ THIS is what marks the order paid
6. Customer is redirected to /orders/{orderNo}/confirmation
   └─ Page polls GET /checkout/status/{orderNo} until paid, with a fallback message
```

## The rule that matters most

**The redirect confirms nothing. The webhook is the source of truth.**

A customer who pays and then closes the browser before redirect must still get their
order and their confirmation email. Never mark an order paid based on the return URL.
Conversely, never mark it failed because the customer landed on the cancel URL — they may
have paid and hit back.

## Session creation

Line items must be sent in centavos, matching our order exactly, so the amount the
customer sees equals the amount we recorded.

```ts
const res = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
  },
  body: JSON.stringify({
    data: {
      attributes: {
        line_items: order.items.map((i) => ({
          name: `${i.productName} — ${i.variantName}`,
          quantity: i.quantity,
          amount: i.unitPriceCents,
          currency: "PHP",
        })),
        payment_method_types: ["gcash", "paymaya", "card", "grab_pay", "dob", "qrph"],
        reference_number: order.orderNo,
        description: `TapatShop order ${order.orderNo}`,
        send_email_receipt: false,
        success_url: `${BASE_URL}/orders/${order.orderNo}/confirmation`,
        cancel_url: `${BASE_URL}/checkout?cancelled=${order.orderNo}`,
        metadata: { orderId: order.id, orderNo: order.orderNo },
      },
    },
  }),
});
```

Shipping and discounts must be represented as line items (a positive shipping line, a
negative discount line if supported — otherwise fold the discount into the item amounts).
The sum of line items must equal `order.totalCents` exactly. Assert this before calling.

Send an `Idempotency-Key` header derived from the order id so a retried request doesn't
create two sessions.

## Webhook handler

Register the endpoint once per environment. Events to subscribe to:
`checkout_session.payment.paid`, `payment.paid`, `payment.failed`, `payment.refunded`,
`payment.refund.updated`.

### Signature verification

Verify against the **raw request body**. Not the parsed object, not a re-serialised
version — whitespace and key order differences will break the HMAC.

```ts
export async function POST(req: Request) {
  const raw = await req.text();                    // raw, before any JSON.parse
  const sig = req.headers.get("paymongo-signature")!;
  if (!verifyPaymongoSignature(raw, sig, process.env.PAYMONGO_WEBHOOK_SECRET!)) {
    return new Response("invalid signature", { status: 401 });
  }
  const event = JSON.parse(raw);
  // ...
}
```

Make sure no middleware parses the body on this route.

### Idempotency and speed

```
1. Verify signature → 401 if bad
2. INSERT INTO webhook_events (provider, eventId, ...) 
   └─ On duplicate key: already seen → return 200 immediately, do nothing
3. Return 200 NOW
4. Process asynchronously (queue or after-response)
5. Set processedAt, or record error and let a retry job pick it up
```

Return 200 fast. PayMongo retries a failed delivery up to 12 times, and if three
consecutive events each exhaust all retries, the webhook endpoint is **disabled
automatically** and must be re-enabled manually in the dashboard. A slow handler can
therefore take payments offline. Add a monitor that alerts if no webhook has been received
in 24 hours.

### On `checkout_session.payment.paid`

Inside one transaction:
1. Look up the order via `reference_number` / `metadata.orderNo`
2. If already `paid`, stop — idempotent no-op
3. Update `Payment`: status, method, providerPaymentId, feeCents, netCents, paidAt, rawPayload
4. Order: `paymentStatus = paid`, `status = confirmed`, `paidAt = now`
5. Decrement stock via `InventoryMovement` (reason `sale`, `orderId` set)
6. Release the stock reservations
7. Increment coupon usage, write `CouponRedemption`
8. Write an `OrderEvent`
9. Queue the confirmation email

If stock has somehow gone negative between reservation and payment, still mark the order
paid — the money is real — then flag it for admin attention rather than silently failing.

## Refunds

`POST /api/v1/admin/orders/:id/refund` with `amountCents`, `reason`, `restockItems`.

- Call PayMongo's refund endpoint with the `providerPaymentId`
- Create a `Refund` row as `pending`; confirm it on the `payment.refunded` webhook
- If `restockItems`, write `InventoryMovement` rows with reason `refund_return`
- Update `order.refundedCents`; set `partially_refunded` or `refunded` accordingly
- Write an `AuditLog` — always
- Refunds are irreversible: require a typed confirmation in the admin UI

## Testing

Use test keys throughout development. Expose the local webhook endpoint with a tunnel
(cloudflared or ngrok) — you cannot develop this feature without receiving real callbacks.

Cases that must be covered before go-live:
- Happy path per payment method
- Customer abandons on the PayMongo page → reservation expires, stock returns
- Payment fails → order not confirmed, stock returns
- Webhook arrives **before** the browser redirect (this is common and must work)
- Webhook arrives twice → no double stock decrement, no duplicate email
- Webhook arrives while the app is down → replayed on retry and processed correctly
- Two customers buy the last unit simultaneously → exactly one succeeds
- Partial refund, then full refund
- Amount mismatch between session and order → reject and alert

## Go-live checklist

- Live keys stored as environment secrets, never committed
- Webhook registered against the production URL with the live secret
- `send_email_receipt` decision confirmed with the client
- Payout bank account verified in the PayMongo dashboard
- Full happy and unhappy paths walked through in test mode first
- Alerting on webhook failures and on any order stuck in `awaiting_payment` for over an hour
