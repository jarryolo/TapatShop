# 04 — API specification

Base path `/api/v1`. JSON only. This is the contract the mobile app will consume, so it
must stay stable once P3 ships.

## Conventions

- Auth via `Authorization: Bearer <jwt>` or the session cookie. Both accepted.
- Guest cart identified by the `tapat_cart` httpOnly cookie, or an `X-Cart-Token` header
  for the mobile app.
- All money fields are integer centavos, suffixed `Cents`.
- Timestamps are ISO 8601 UTC.
- Pagination: `?page=1&limit=24`, response includes `{ data, meta: { page, limit, total, totalPages } }`.

**Error shape** — always this, never a bare string:

```json
{ "error": { "code": "OUT_OF_STOCK", "message": "Only 2 left in stock.", "details": { "variantId": "...", "available": 2 } } }
```

Codes: `VALIDATION_ERROR` 422 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 ·
`OUT_OF_STOCK` 409 · `CART_STALE` 409 · `RATE_LIMITED` 429 · `PAYMENT_FAILED` 402 ·
`INTERNAL` 500.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/products` | `?category=&q=&minPrice=&maxPrice=&sort=newest\|price_asc\|price_desc\|popular&inStock=` |
| GET | `/products/:slug` | Full detail with variants, images, approved reviews |
| GET | `/products/:slug/related` | 4 items from the same category |
| GET | `/categories` | Nested tree |
| GET | `/search/suggest` | `?q=` — max 8 results, name + image + price |
| GET | `/banners` | `?placement=home_hero` |
| GET | `/shipping/quote` | `?region=&subtotalCents=&weightGrams=` → available rates |
| GET | `/orders/track` | `?orderNo=&email=` — guest tracking, rate limited to 5/min per IP |
| GET | `/health` | Uptime probe |

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | name, email, password, phone, privacyAgreed. Sends verification email. |
| POST | `/auth/login` | Returns JWT. Rate limited 5/min per email + IP. |
| POST | `/auth/verify-email` | token |
| POST | `/auth/forgot-password` | Always returns 200 regardless of whether the email exists |
| POST | `/auth/reset-password` | token, newPassword |
| POST | `/auth/set-password` | Authed. For Google-only accounts adding a password. |
| POST | `/auth/otp/request` | phone. Recovery or verification. Rate limited. |
| POST | `/auth/otp/verify` | phone, code. Max 3 attempts then 15-min lockout. |
| GET | `/auth/providers` | Authed. Which sign-in methods this account has. |
| DELETE | `/auth/providers/:provider` | Authed. Refuses if it would leave zero sign-in methods. |

## Cart

| Method | Path | Notes |
|---|---|---|
| GET | `/cart` | Returns priced cart. Recomputes from DB every time — never trusts stored totals. |
| POST | `/cart/items` | variantId, quantity. Clamps to available stock and says so. |
| PATCH | `/cart/items/:id` | quantity. Zero removes. |
| DELETE | `/cart/items/:id` | |
| POST | `/cart/merge` | Called after login with the guest token |
| POST | `/cart/coupon` | code. Validates eligibility and returns the recalculated cart. |
| DELETE | `/cart/coupon` | |

## Checkout

| Method | Path | Notes |
|---|---|---|
| POST | `/checkout/validate` | Re-prices the cart, checks stock, returns any changes since the customer last looked |
| POST | `/checkout/session` | addressId or inline address, shippingRateId. Reserves stock, creates the order as `pending`, creates the PayMongo checkout session, returns `{ orderNo, checkoutUrl }` |
| GET | `/checkout/status/:orderNo` | Polled by the return page while the webhook lands |

`POST /checkout/session` is the most important endpoint in the system. It must, in one
transaction: re-price server-side, verify stock, reserve stock, create the order, and only
then call PayMongo. If the PayMongo call fails, release the reservation and roll back.

## Account

| Method | Path |
|---|---|
| GET / PATCH | `/me` |
| POST | `/me/password` |
| GET / POST | `/me/addresses` |
| PATCH / DELETE | `/me/addresses/:id` |
| GET | `/me/orders` |
| GET | `/me/orders/:orderNo` |
| POST | `/me/orders/:orderNo/reorder` |
| GET / POST / DELETE | `/me/wishlist` |
| GET | `/me/notifications` |
| POST | `/me/notifications/read` |
| POST | `/me/reviews` |
| POST | `/me/deletion-request` |

## Admin — requires role `admin` or `staff`

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/dashboard` | Sales today, pending orders, low stock, top products |
| GET | `/admin/orders` | Filters: status, paymentStatus, fulfillmentStatus, date range, q |
| GET | `/admin/orders/:id` | |
| POST | `/admin/orders/:id/transition` | Validated against the state machine |
| POST | `/admin/orders/:id/tracking` | carrier, trackingNumber. Triggers the shipped email. |
| POST | `/admin/orders/:id/refund` | amountCents, reason, restockItems |
| GET | `/admin/orders/export` | CSV |
| GET/POST | `/admin/products` | |
| PATCH/DELETE | `/admin/products/:id` | |
| POST | `/admin/products/:id/variants` | |
| POST | `/admin/products/import` | CSV, returns a per-row error report |
| POST | `/admin/media/presign` | Returns a presigned S3 upload URL |
| GET | `/admin/inventory` | `?lowStock=true` |
| POST | `/admin/inventory/adjust` | variantId, delta, reason, note. Reason is mandatory. |
| GET | `/admin/inventory/:variantId/movements` | |
| GET | `/admin/customers` | |
| POST | `/admin/customers/:id/verify-member` | memberNo, chapter |
| POST | `/admin/customers/:id/recovery` | Starts admin-assisted account recovery. Admin-only. |
| GET/POST/PATCH | `/admin/coupons` | |
| GET/PUT | `/admin/settings/:key` | Admin-only |
| GET/POST/DELETE | `/admin/staff` | Admin-only |
| GET | `/admin/audit-logs` | Admin-only |

## Webhooks

| Method | Path | Notes |
|---|---|---|
| POST | `/webhooks/paymongo` | No auth. Signature-verified against the raw body. Must not be behind middleware that parses the body. See `docs/06`. |

## Rate limits

Redis-backed, keyed by IP and by user where authenticated.

- Auth endpoints: 5/min
- OTP request: 3/hour per phone
- Guest order tracking: 5/min
- Checkout session: 10/min per user
- Search suggest: 30/min
- Everything else: 120/min
