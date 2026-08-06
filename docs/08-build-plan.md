# 08 — Build plan

Work these in order. One ticket per session, one commit per ticket, human review before
moving on. Do not start a ticket whose dependencies aren't merged.

Each ticket has acceptance criteria. A ticket is not done until every box is true **and**
`pnpm typecheck && pnpm lint && pnpm test` passes.

---

## Phase 0 — Decisions (no code)

**P0-01 · Confirm open questions.** ✅ **Done, 2026-08-06.**

1. **Single store.** One catalog, one admin team, one PayMongo account. No vendor role.
2. **No cash on delivery in v1.** PayMongo prepaid only. Out of scope, revisit post-launch.
3. **Member pricing is a store-wide percentage** applied to every product for verified
   members, held in the `member_discount_percent` setting. Rules and rounding in
   `docs/01-product-spec.md`. `ProductVariant.memberPriceCents` was removed from the schema
   as a result — there is exactly one place member price is computed.

**P0-02 · Accounts and access.** PayMongo test + live keys, MinIO or R2 credentials, Resend
key, SMS provider account, VPS, domain, Google OAuth client, Sentry DSN.

---

## Phase 1 — Foundation

**P1-01 · Repo scaffold.**
Monorepo per `docs/02`. Next.js 15 + TypeScript strict + Tailwind + ESLint + Prettier +
Vitest. Docker Compose with `mysql`, `redis`, `minio`. `.env.example` filled in.
- [ ] `docker compose up` brings up MySQL, Redis, MinIO
- [ ] `pnpm dev` serves a page at localhost:3000
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass on an empty project
- [ ] README documents local setup in under ten steps

**P1-02 · Database and seed.**
The schema is already at `packages/db/prisma/schema.prisma`. Generate the initial migration.
Write `seed.ts` per `docs/03`.
- [ ] Migration applies cleanly to an empty database
- [ ] Seed creates admin, staff, 2 customers (1 verified member), 4 categories, 12 products
      with multiple variants, 4 shipping zones, 2 coupons, 6 orders across statuses
- [ ] `pnpm db:reset` drops, migrates, and seeds in one command

**P1-03 · Money and format utilities.**
`lib/utils/money.ts` and `format.ts`. Centavo arithmetic, PHP formatting, Asia/Manila dates.
- [ ] `formatPeso(123450)` → `₱1,234.50`
- [ ] Percentage discounts round consistently and never produce fractional centavos
- [ ] `memberPrice(priceCents, percent)` rounds once per unit per `docs/01`, so
      `lineTotal == memberUnitPrice * qty` holds exactly
- [ ] Unit tests cover zero, negative, and large values

**P1-04 · Design system primitives.**
Tokens into `globals.css` and the Tailwind theme. Build every component in `docs/05`.
- [ ] Every primitive has default, hover, active, focus-visible, disabled, loading states
- [ ] A `/dev/ui` page renders all of them for review
- [ ] Keyboard navigable with a visible focus ring
- [ ] Body text passes 4.5:1 contrast

**P1-05 · Auth.**
Auth.js with credentials + Google per `docs/07`. Registration, login, email verification,
forgot/reset password, account linking rules, middleware route protection.
- [ ] Google-only account attempting password login gets the correct guidance, not "wrong password"
- [ ] Same verified email across providers auto-links; unverified does not
- [ ] Forgot-password returns an identical response for existing and non-existing emails
- [ ] Reset tokens are hashed, single-use, and expire in 30 minutes
- [ ] `/admin` redirects non-admins; every admin route handler re-checks role server-side
- [ ] Rate limits enforced on login, register, and reset

**P1-06 · Media pipeline.**
Presigned S3 uploads, 1:1 auto-crop, WebP conversion, four responsive widths.
- [ ] Upload returns a CDN-ready URL
- [ ] Non-image and oversized files are rejected with a clear error
- [ ] Images under 1000×1000 are rejected

**P1-07 · Admin shell.**
Sidebar layout, role-based nav, `DataTable`, `StatusPill`, empty and loading states.
- [ ] Staff sees a reduced nav; settings and staff pages are admin-only
- [ ] Table supports sort, filter, pagination, and keyboard navigation

**P1-08 · Product and category management.**
Full CRUD, variant matrix editor, drag-and-drop image ordering, publish/unpublish.
- [ ] A product cannot be published without at least one variant, one image with alt text, and a price
- [ ] SKUs are unique and the collision error is human-readable
- [ ] Every mutation writes an `AuditLog` with before and after

---

## Phase 2 — Storefront

**P2-01 · Catalog listing.** Home, category pages, filters, sort, pagination.
- [ ] Grid is 2-up mobile, 4-up desktop, matching `docs/05`
- [ ] Filters and sort are URL state and survive refresh and sharing
- [ ] No N+1 queries — verify with Prisma query logging
- [ ] LCP under 2.5s on a throttled 4G profile

**P2-02 · Search.** FULLTEXT search plus autocomplete.
- [ ] Suggest returns in under 200ms with seed data
- [ ] Partial and misspelled queries return something useful or a real empty state
- [ ] Rate limited to 30/min

**P2-03 · Product detail.** Gallery, variant picker, stock state, related products.
- [ ] Selecting a variant updates price, SKU, stock, and image without a page reload
- [ ] Out-of-stock variants are visibly disabled, not hidden
- [ ] "Only N left" appears at or below the low-stock threshold
- [ ] Member price shows only for verified members

**P2-04 · Cart.** Guest cart by cookie, cart drawer, quantity updates, merge on login.
- [ ] Guest cart survives browser restart for 30 days
- [ ] Login merges quantities correctly without duplicating lines
- [ ] Quantities are clamped to available stock with an explicit message
- [ ] Totals are always recomputed server-side
- [ ] Test: item goes out of stock while in the cart → cart shows it clearly

---

## Phase 3 — Checkout and payments

Staging environment with a webhook tunnel must exist before starting.

**P3-01 · Shipping rules.** Zones, rates, free-shipping threshold, PH address cascade.
- [ ] Region → province → city → barangay cascade works with real PH data
- [ ] Quote endpoint returns correct rates for each zone
- [ ] Free-shipping threshold applies at exactly the boundary value

**P3-02 · Checkout flow.** Three steps, server-side re-pricing, coupon application.
- [ ] Client-supplied prices are ignored entirely — test by tampering with the payload
- [ ] Price or stock changes since the cart page are surfaced before payment, not after
- [ ] Coupon eligibility, expiry, usage caps, and member-only rules all enforced server-side
- [ ] Member discount applied server-side at the unit level, then the coupon at the subtotal
      level; a member with an unverified email gets list price
- [ ] Guest checkout works end to end

**P3-03 · Stock reservation.** Per `docs/03`, with `FOR UPDATE` locking and Redis TTL.
- [ ] **Concurrency test:** two simultaneous checkouts for the last unit — exactly one succeeds
- [ ] Reservations expire after 15 minutes and stock returns
- [ ] The sweeper releases reservations Redis lost

**P3-04 · PayMongo integration.** Checkout session creation per `docs/06`.
- [ ] Line items sum exactly to `order.totalCents`; assertion fails loudly if not
- [ ] Idempotency key prevents duplicate sessions on retry
- [ ] PayMongo failure releases reservations and rolls the order back
- [ ] GCash, Maya, card, and QRPh all complete in test mode

**P3-05 · Webhook handler.** Signature verification, idempotency, async processing.
- [ ] Signature verified against the **raw** body; no middleware parses it
- [ ] Duplicate event ids are a no-op — no double stock decrement, no duplicate email
- [ ] Handler returns 200 in under 500ms
- [ ] Webhook arriving before the browser redirect works correctly
- [ ] Replayed events after downtime process correctly
- [ ] Every case in the `docs/06` testing list has a passing test

**P3-06 · Order lifecycle and email.** State machine, order events, transactional email.
- [ ] Illegal transitions throw; the admin UI only offers legal ones
- [ ] Confirmation, shipped, delivered, and refunded emails all send and render on mobile
- [ ] Customer timeline shows public events only
- [ ] Guest order tracking works with order number + email

---

## Phase 4 — Operations

**P4-01 · Admin orders.** List, detail, transitions, tracking, packing slip, CSV export.
- [ ] Adding a tracking number sends the shipped email exactly once
- [ ] Packing slip prints cleanly on A4

**P4-02 · Refunds.** Full and partial, with optional restock.
- [ ] Refund calls PayMongo and reconciles on the webhook
- [ ] Restock writes `refund_return` movements
- [ ] `refundedCents` can never exceed `totalCents`
- [ ] Requires typed confirmation; always writes an `AuditLog`

**P4-03 · Inventory.** Stock list, low-stock filter, manual adjustment, movement history.
- [ ] Adjustment without a reason is rejected
- [ ] Movement history shows actor, delta, reason, and running balance
- [ ] A reconciliation command rebuilds `stockQty` from the ledger and reports drift

**P4-04 · Customers and members.** Profiles, order history, lifetime value, member verification.
- [ ] Member verification is admin-only and audited
- [ ] Admin-assisted recovery flow works per `docs/07` and never exposes a password

**P4-05 · Coupons.** CRUD plus enforcement.
- [ ] Usage caps hold under concurrent redemption

**P4-06 · Dashboard, content, settings, audit log.**
- [ ] Dashboard figures reconcile against a manual query
- [ ] Audit log is filterable by actor, entity, and date

**P4-07 · Reviews and wishlist.**
- [ ] Only verified purchasers can review; reviews require moderation before display
- [ ] Back-in-stock notification fires on restock

---

## Phase 5 — Launch readiness

**P5-01 · Compliance pages.** Terms, privacy policy, returns policy, DPA consent, deletion request flow.

**P5-02 · SEO and metadata.** Product structured data, sitemap, robots, OG images, canonical URLs.

**P5-03 · Security pass.**
- [ ] Rate limits on every sensitive endpoint
- [ ] No secrets in the repo; `.env` gitignored
- [ ] CSP, HSTS, and security headers set
- [ ] Admin two-factor enabled
- [ ] Dependency audit clean
- [ ] Verified: no endpoint trusts a client-supplied price, quantity, or role

**P5-04 · Performance and load test.**
- [ ] LCP targets met on home, category, and product pages
- [ ] 100 concurrent checkouts without stock corruption

**P5-05 · Backups and monitoring.**
- [ ] Nightly `mysqldump` off-server
- [ ] **A restore has been performed on a clean machine and verified**
- [ ] Sentry, uptime checks, and a webhook-silence alert are live

**P5-06 · PayMongo go-live.** Live keys, production webhook registered, payout account
verified, one real low-value transaction completed and refunded end to end.

**P5-07 · Soft launch.** Invite-only to members. Two weeks. Fix what surfaces before the
public announcement.

---

## Phase 6 — Mobile app

Do not start until the web app has been live for a month. `/api/v1` must be stable first.
Expo + React Native, shared types and Zod schemas from `packages/shared`, PayMongo hosted
checkout in a WebView, Expo push for order status, deep links to products.

Budget for Apple and Google developer accounts, and note that Apple rejects shopping apps
that are thin website wrappers — real native navigation is required.

---

## Estimate

| Phase | Duration |
|---|---|
| 0 | 2–3 days |
| 1 | 2–3 weeks |
| 2 | 2–3 weeks |
| 3 | 2 weeks |
| 4 | 2 weeks |
| 5 | 1–2 weeks |
| **Web launch** | **11–15 weeks** |
| 6 | 4–6 weeks |

Assumes one designer and two developers. Phase 3 is where slippage happens — payments and
concurrency take longer than they look, and rushing them is how stores lose money quietly.
