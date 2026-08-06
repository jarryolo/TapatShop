# 03 — Data model

The schema is in `packages/db/prisma/schema.prisma`. That file is the source of truth. This document
explains the reasoning and the rules the application code must uphold.

## The five decisions that matter

**1. Money is integer centavos, everywhere.**
`priceCents`, `totalCents`, `discountCents`. Never a float, never a `Decimal`, never a
string. `₱480.00` is `48000`. Format at render time only, in `lib/utils/money.ts`. This
single rule eliminates an entire class of rounding bugs that only surface in production
totals and reconciliation.

**2. Products have variants, always.**
Even a product with no options gets one `ProductVariant` named "Default". Price, SKU, and
stock live on the variant, never on the product. This avoids the painful migration that
happens when a single-price product later needs sizes.

**3. Inventory is a ledger, not a number.**
`InventoryMovement` is append-only and records `delta`, `reason`, `balanceAfter`, and who
did it. `ProductVariant.stockQty` is a **derived cache**. Never write to `stockQty` except
in the same transaction as a movement row. A reconciliation job can rebuild `stockQty`
from the ledger — that's the point. When stock is mysteriously wrong, the ledger tells you
exactly why.

**4. Order lines are snapshots.**
`OrderItem` copies `productName`, `variantName`, `sku`, `imageUrl`, and `unitPriceCents`
at purchase time. `variantId` is kept nullable and for reference only. If someone renames
a product or raises its price next month, last month's invoices must not change. Never
render a historical order by joining to `Product`.

**5. Address is snapshotted onto the order as JSON.**
`Order.shippingAddress` is a frozen copy. If the customer later edits their address book,
the shipped order still shows where it actually went.

## Invariants the code must enforce

These cannot be expressed in the schema, so they belong in `lib/services/` and in tests.

| # | Invariant |
|---|---|
| I1 | `Order.totalCents == subtotalCents + shippingCents + vatCents - discountCents` |
| I2 | `OrderItem.lineTotalCents == unitPriceCents * quantity` |
| I3 | `Order.subtotalCents == sum(items.lineTotalCents)` |
| I4 | `ProductVariant.stockQty == sum(movements.delta)` for that variant |
| I5 | Available stock = `stockQty - active reservations`. Never sell below zero. |
| I6 | `Order.refundedCents <= totalCents` |
| I7 | An order may only be `paymentStatus = paid` if a `Payment` row with `status = paid` exists |
| I8 | Every `paid` transition writes an `OrderEvent` and, for admin actions, an `AuditLog` |

## Order state machine

Three independent axes. Do not collapse them into one status field — real orders need to
be "confirmed and paid but not yet shipped", and a single enum makes that combinatorially
awful.

```
status:            pending → confirmed → completed
                       ↓         ↓
                   cancelled  cancelled

paymentStatus:     unpaid → awaiting_payment → paid → partially_refunded → refunded
                                    ↓
                                 failed

fulfillmentStatus: unfulfilled → packed → shipped → delivered
                                                        ↓
                                                    returned
```

Legal transitions live in `lib/services/order.service.ts` as an explicit map. Any illegal
transition throws. Do not allow arbitrary status writes from the admin UI.

## Stock reservation

The race condition on the last unit is the most likely production bug in this system.

1. At checkout session creation, inside a transaction: re-read `stockQty`, subtract active
   reservations, and if sufficient, write a `StockReservation` row **and** a Redis key
   `resv:{variantId}:{cartId}` with a 900-second TTL.
2. Actual stock is **not** decremented yet — only reserved.
3. On the `paid` webhook: decrement stock via `InventoryMovement` with reason `sale`, and
   release the reservation.
4. On expiry, failure, or abandonment: a sweeper job releases the reservation. Redis TTL
   handles the fast path; a cron sweeps the durable table for anything Redis lost.

Use `SELECT ... FOR UPDATE` on the variant row inside the reservation transaction. This is
one of the few places raw SQL or `$queryRaw` is justified — comment it.

## Guest carts

`Cart` has either `userId` or `guestToken`, never both meaningfully. The guest token is an
httpOnly cookie with a 30-day expiry. On login, `mergeGuestCart` sums quantities for
matching variants, clamps each to available stock, and deletes the guest cart. Merging is
where duplicate-line bugs hide — test it directly.

## Indexing notes

`products` uses a MySQL `FULLTEXT` index on name, brand, and description. This is fine up
to roughly ten thousand products. If search quality becomes a complaint, add Meilisearch
as a read-side index — do not restructure the schema for it.

Composite indexes on `orders(status, createdAt)` and `product_variants(stockQty)` support
the admin dashboard queries directly. Check `EXPLAIN` before adding any others.

## Seed data

`packages/db/seed.ts` must create: an admin user, a staff user, two customers (one a
verified member), four categories, twelve products with realistic PH pricing and multiple
variants, four shipping zones with rates, two coupons, and six orders spread across every
status combination. The admin dashboard cannot be built or reviewed against an empty
database.
