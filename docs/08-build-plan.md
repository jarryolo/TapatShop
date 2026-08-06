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
- [ ] `pnpm docker:up` brings up MySQL, Redis, MinIO — **not yet verified**, Docker is not
      installed on the machine the scaffold was built on. The compose YAML parses and the
      service definitions are complete; someone with Docker must confirm they boot.
- [x] `pnpm dev` serves a page at localhost:3000, and `/api/v1/health` answers `{"status":"ok"}`
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass on an empty project
- [x] README documents local setup in six steps

**P1-02 · Database and seed.**
The schema is already at `packages/db/prisma/schema.prisma`. Generate the initial migration.
Write `seed.ts` per `docs/03`.
- [x] Migration applies cleanly to an empty database — verified against a scratch database,
      30 tables created
- [x] Seed creates admin, staff, 2 customers (1 verified member), 4 categories, 12 products
      across 21 variants, 4 shipping zones with 5 rates, 2 coupons, 7 orders across statuses.
      Invariants I1–I7 and I9 verified in SQL independently of the seed's own check.
- [ ] `pnpm db:reset` drops, migrates, and seeds in one command — **someone else must run
      this once.** Prisma Migrate refuses `migrate reset` when it detects it was invoked by
      Claude Code. That guardrail is correct and was not worked around. Both halves are known
      good: `migrate deploy` applies cleanly to an empty database, and `pnpm db:seed` passes.

**P1-03 · Money and format utilities.**
`lib/utils/money.ts` and `format.ts`. Centavo arithmetic, PHP formatting, Asia/Manila dates.
- [x] `formatPeso(123450)` → `₱1,234.50`
- [x] Percentage discounts round consistently and never produce fractional centavos
- [x] `memberPrice(priceCents, percent)` rounds once per unit per `docs/01`, so
      `lineTotal == memberUnitPrice * qty` holds exactly
- [x] Unit tests cover zero, negative, and large values

**P1-04 · Design system primitives.**
Tokens into `globals.css` and the Tailwind theme. Build every component in `docs/05`.
- [x] Every primitive has default, hover, active, focus-visible, disabled, loading states
- [x] A `/dev/ui` page renders all of them for review — 404s in production, verified against
      a real production build
- [x] Keyboard navigable with a visible focus ring — one global `:focus-visible` rule, tabs
      use a roving tabindex, dialogs trap focus natively
- [x] Body text passes 4.5:1 contrast — enforced by `components/ui/tokens.test.ts`. Four
      tokens in `docs/05` failed and were corrected; see "Contrast corrections" there.

**P1-05 · Auth.**
Auth.js with credentials + Google per `docs/07`. Registration, login, email verification,
forgot/reset password, account linking rules, middleware route protection.
- [x] Google-only account attempting password login gets the correct guidance, not "wrong password"
- [x] Same verified email across providers auto-links; unverified does not
- [x] Forgot-password returns an identical response for existing and non-existing emails —
      verified live: same status and same body byte for byte
- [x] Reset tokens are hashed, single-use, and expire in 30 minutes
- [x] `/admin` redirects non-admins; every admin route handler re-checks role server-side —
      verified live for admin, staff, customer, and anonymous
- [x] Rate limits enforced on login, register, and reset

Two things landed alongside, both needed to make the above true:

- A `purpose` column on the token table. Verification and reset tokens shared one table, so a
  24-hour verification link doubled as a password reset. Migration `token_purpose`.
- Rate limits are keyed on IP **and** identifier together, per docs/04's "per email + IP",
  with a separate looser per-IP ceiling. A bare per-IP limit of 5 locks out everyone behind
  carrier-grade NAT, which is a large share of PH traffic.

Deferred, and not claimed: phone OTP recovery, admin-assisted recovery
(`/admin/customers/:id/recovery`), recovery email, and admin TOTP. They are docs/07 items but
belong with P4-04 and P5-03, where the admin customer view exists to host them.

**P1-06 · Media pipeline.**
Presigned S3 uploads, 1:1 auto-crop, WebP conversion, four responsive widths.
- [ ] Upload returns a CDN-ready URL
- [ ] Non-image and oversized files are rejected with a clear error
- [ ] Images under 1000×1000 are rejected

**P1-07 · Admin shell.**
Sidebar layout, role-based nav, `DataTable`, `StatusPill`, empty and loading states.
- [~] Staff sees a reduced nav; settings and staff pages are admin-only — the nav filtering
      and `canAccess` are built and tested, but the **role comes from a fixture**. The real
      session check and `middleware.ts` gate land with P1-05. These pages are currently open
      to anyone who knows the URL.
- [x] Table supports sort, filter, pagination, and keyboard navigation

Built ahead of P1-05 while the database was unavailable, so it renders fixture data. Delete
`lib/admin/fixtures.ts` when auth lands.

**P1-08 · Product and category management.**
Full CRUD, variant matrix editor, drag-and-drop image ordering, publish/unpublish.
- [x] A product cannot be published without at least one variant, one image with alt text, and a price
      — plus a description. Every blocker is returned at once, not one per attempt.
- [x] SKUs are unique and the collision error is human-readable — names the offending SKUs,
      catches duplicates within a single submitted matrix, and is case-insensitive
- [x] Every mutation writes an `AuditLog` with before and after — recording only the fields
      that changed, with actor, IP, and user agent

**Image upload is not here.** It needs the presigned S3 flow from P1-06, which needs MinIO,
which needs Docker. Ordering and alt-text editing work against existing image rows; the
upload button arrives with P1-06. Reordering uses buttons rather than only drag-and-drop
because dragging is unusable with a keyboard — docs/05 requires keyboard reach.

CSV import and export are also deferred: they belong with the bulk-edit work and are listed
separately in the P1-08 description.

---

## Phase 2 — Storefront

**P2-01 · Catalog listing.** Home, category pages, filters, sort, pagination.
- [x] Grid is 2-up mobile, 4-up desktop, matching `docs/05`
- [x] Filters and sort are URL state and survive refresh and sharing — pagination carries
      every other filter, and an unparseable query string falls back rather than erroring
- [x] No N+1 queries — measured with `PRISMA_LOG_QUERIES=true`: **8 statements for a page of
      12 products and 8 for a page of 4.** Constant, not proportional.
- [ ] LCP under 2.5s on a throttled 4G profile — **not measured.** Needs Lighthouse or a
      throttled browser profile, which is not available here. First Load JS is 119 kB and the
      pages are server-rendered with `revalidate = 300`, but that is a proxy, not the number.
      The real lever is images: they are plain `<img>` with no optimisation until P1-06 gives
      next/image a loader and real files, so measuring before then would not reflect launch.

**P2-02 · Search.** FULLTEXT search plus autocomplete.
- [x] Suggest returns in under 200ms with seed data — production build, 20 queries: median
      33ms, max 44ms. Measured against `pnpm start`, not `pnpm dev`; the dev server's
      on-demand compilation put one sample at 235ms and that number means nothing.
- [x] Partial and misspelled queries return something useful or a real empty state —
      "bara" → Barako coffee (FULLTEXT prefix), "barrako" and "cofee" → Barako coffee
      (edit distance), "zzzzz" → empty state with a link to browse everything
- [x] Rate limited to 30/min — 30 through, 429 on the 31st, `Retry-After: 59`

**P2-03 · Product detail.** Gallery, variant picker, stock state, related products.
- [x] Selecting a variant updates price, SKU, stock, and image without a page reload — every
      variant's data is sent with the page, so selection is local state with no round trip
- [x] Out-of-stock variants are visibly disabled, not hidden — verified by taking a variant
      to zero through the ledger: it stays listed, struck through, marked "(sold out)", and
      its radio is `disabled`
- [x] "Only N left" appears at or below the low-stock threshold — verified with a variant at
      2 against a threshold of 5
- [x] Member price shows only for verified members — verified across three sessions: guest
      no, signed-in non-member no, verified member yes

Add to cart is a placeholder until P2-04. The button is present and correctly disabled when
out of stock; pressing it explains where the cart is rather than doing nothing.

**P2-04 · Cart.** Guest cart by cookie, cart drawer, quantity updates, merge on login.
- [x] Guest cart survives browser restart for 30 days — `tapat_cart` is httpOnly with a
      30-day expiry, and the expiry rolls forward on every write so an active shopper's cart
      does not lapse mid-shop
- [x] Login merges quantities correctly without duplicating lines — verified over real HTTP:
      quantities sum, the unique `(cartId, variantId)` constraint is respected, and running
      the merge twice is a no-op
- [x] Quantities are clamped to available stock with an explicit message — asking for 5 of a
      variant with 2 left returns "Only 2 in stock, so we added 2."
- [x] Totals are always recomputed server-side — the cart stores variant ids and quantities
      only. A price change between two reads shows up immediately; there is no stored total
      to tamper with or go stale.
- [x] Test: item goes out of stock while in the cart → cart shows it clearly — the line stays
      listed with an `out_of_stock` issue, is charged at zero, and is excluded from the item
      count. Checkout is blocked until it is removed.

Coupons (`POST/DELETE /cart/coupon` in docs/04) are deferred to P3-02, where eligibility,
expiry, usage caps and member-only rules are enforced together.

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
