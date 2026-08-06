# 01 — Product specification

## What TapatShop is

An online store operated by a brotherhood of Christian businessmen and professionals in
the Philippines. The organisation sells a curated catalog — member-made goods, branded
merchandise, books, food products — to members and to the general public.

"Tapat" means honest, upright, straight. The product should feel that way: clear pricing,
no dark patterns, no fake urgency, no manipulative countdown timers.

## Users

| Role | Description |
|---|---|
| Guest | Can browse, search, add to cart, and check out without an account. Can track an order with order number + email. |
| Customer | Registered. Saved addresses, order history, wishlist, reorder. |
| Member | A customer with a verified `member_no`. Eligible for member pricing. Verification is done by an admin, not self-declared. |
| Staff | Admin portal access limited to orders, inventory, and customers. Cannot change settings or manage staff. |
| Admin | Full access including settings, staff management, and audit log. |

Roles are a single enum on `users`. Member status is a separate verified flag, not a role.

## Member pricing

A single store-wide percentage, not a per-product price. Decided in P0-01.

- The rate lives in the `member_discount_percent` setting — an integer 0–100, admin-editable
  under settings. It is never hardcoded. Setting it to `0` disables member pricing entirely
  without any code change.
- It applies to every active product, on top of whatever the variant's current `priceCents`
  is. If a product is already discounted against its `compareAtPrice`, the member percentage
  comes off the current price, not the compare-at price.
- **Computed per unit, then rounded**:
  `memberUnitPriceCents = priceCents - round(priceCents * percent / 100)`.
  Per unit and rounded once, so invariant I2 (`lineTotalCents == unitPriceCents * quantity`)
  still holds exactly. Never compute the discount on a line total or a subtotal.
- At checkout the member price becomes the `OrderItem.unitPriceCents` outright. It is **not**
  a `discountCents` line — that field is for coupons only. This keeps a member's invoice
  readable and keeps the two discount mechanisms from fighting over rounding.
- **Stacking order:** member price first at the unit level, then a coupon at the subtotal
  level. A `membersOnly` coupon therefore stacks on top of member pricing by design.
- **Eligibility requires both** `memberVerifiedAt` and `emailVerifiedAt` to be set, per
  `docs/07`. An unverified email means no member price, even with a member number.
- Applied server-side at checkout, always. The displayed price is a convenience; the
  authoritative one is recomputed from the database at `POST /checkout/session`.
- Guests and non-members never see member pricing — not struck through, not "you'd save",
  nothing. That would be the kind of pressure the store is meant to avoid.

`Product.memberOnly` is a separate feature: it controls **visibility**, not price.

## Customer-facing scope

**Browse and discover**
- Home: hero banner, featured products, category tiles, new arrivals
- Category pages with filters (price range, availability, brand) and sort (newest, price, popularity)
- Search with autocomplete over product name, brand, and SKU
- Product detail: image gallery, variant selector, stock state, description, related products, reviews

**Buy**
- Cart: guest cart persisted by cookie token, merged into the user cart on login
- Checkout in three steps: address → shipping method → payment
- Order confirmation page and email

**Account**
- Order list and order detail with a status timeline and tracking number
- Reorder — adds all still-available items back to the cart
- Address book with a default address
- Profile, password, linked sign-in providers
- Wishlist and back-in-stock notifications
- Notification preferences

## Admin scope

**Dashboard** — today's sales, orders awaiting action, low-stock alerts, top products this week.

**Orders** — list with status filters and search; detail view; transition status; add
tracking number; issue full or partial refund; print packing slip; CSV export.

**Products** — CRUD; variant matrix editor; drag-and-drop image upload with reordering;
bulk CSV import and export; publish and unpublish.

**Inventory** — stock list with a low-stock filter; manual adjustment requiring a reason;
per-SKU movement history; restock alerts.

**Customers** — profile, order history, lifetime value, member verification action.

**Content** — homepage banners, featured collections, announcement bar.

**Settings** — store info, shipping zones and rates, VAT config, PayMongo keys, staff accounts.

**Audit log** — filterable record of every admin mutation.

## Selected user stories

Written as acceptance criteria for the build plan to reference.

- As a guest, I can add an item to my cart and still have it there after closing the browser
  and returning within 30 days.
- As a customer, when I log in with items in a guest cart, those items merge into my saved
  cart without duplicating quantities incorrectly.
- As a customer, if I try to buy the last unit of an item at the same moment as someone
  else, exactly one of us succeeds and the other sees a clear out-of-stock message before
  paying — never after.
- As a customer, if I pay successfully and then close my browser before being redirected
  back, my order is still marked paid and I still get a confirmation email.
- As a customer, I can see the exact shipping fee before I am asked to pay.
- As an admin, I can see who changed a product's price, when, and what it was before.
- As an admin, when I refund an order, the stock returns to inventory and a movement row
  records why.
- As a member, I see member pricing on eligible products, and the discount is applied
  server-side at checkout — not just displayed.

## Explicitly out of scope for v1

Multi-vendor marketplace. Cash on delivery. Subscriptions and recurring billing.
Multi-currency. International shipping. Gift cards. Live chat. Loyalty points.

## Compliance

- Data Privacy Act (RA 10173): consent checkbox at registration, privacy policy page,
  account deletion request flow, no unnecessary PII retention.
- BIR: printable invoice with store TIN, VAT breakdown, and sequential invoice number.
- Terms of service and a returns/refunds policy page are required before launch.
