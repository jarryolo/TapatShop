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
- [~] Region → province → city → barangay cascade works with real PH data — the cascade
      works and the data is real, but the dataset is **incomplete on purpose**. All 17
      regions and all 82 provinces are there; cities and barangays cover NCR in full plus
      the largest city per region. The Philippines has ~1,600 cities and ~42,000 barangays,
      and writing those by hand would introduce errors that misroute deliveries silently.
      **Before launch: import the PSA PSGC dataset** (https://psa.gov.ph/classification/psgc).
      The form falls back to free text wherever the dataset is thin, so a partial import
      cannot block a sale.
- [x] Quote endpoint returns correct rates for each zone — verified live across all four
      seeded zones; the seed covers every one of the 17 regions
- [x] Free-shipping threshold applies at exactly the boundary value — ₱2,499 pays ₱80,
      ₱2,500 is free, ₱2,501 is free

**P3-02 · Checkout flow.** Three steps, server-side re-pricing, coupon application.
- [x] Client-supplied prices are ignored entirely — tested by tampering. The request carries
      an address and a rate id and nothing else about money; `seenSubtotalCents` exists only
      so the server can *warn* that something moved. Claiming a ₱370 basket costs 1 centavo
      returns the real ₱370 plus a "prices have changed" notice.
- [x] Price or stock changes since the cart page are surfaced before payment, not after —
      `POST /checkout/validate` reserves nothing and reports every change; a line that has
      become unavailable blocks checkout entirely
- [x] Coupon eligibility, expiry, usage caps, and member-only rules all enforced server-side,
      and revalidated on every cart read — a code that expires while sitting in the cart
      stops discounting and says why
- [x] Member discount applied server-side at the unit level, then the coupon at the subtotal
      level; a member with an unverified email gets list price
- [x] Guest checkout works end to end — verified live: order `TS-2026-000108` created as a
      guest, I1 and I2 both hold, stock reserved and **not** decremented

PayMongo itself is P3-04. `payment.service.ts` is the seam: in development with no key it
returns a stub session so the flow can be walked end to end; in production it refuses rather
than stubbing, because a stub that worked in production would hand out free orders. The stub
page never marks an order paid — only a verified webhook may do that (docs/06).

**P3-03 · Stock reservation.** Per `docs/03`, with `FOR UPDATE` locking and Redis TTL.
- [x] **Concurrency test:** two simultaneous checkouts for the last unit — exactly one
      succeeds. Also holds for ten simultaneous attempts on three units: exactly three win
      and nothing oversells. **The test was proved able to fail**: the same race run without
      `SELECT ... FOR UPDATE` oversells, holding 2 units of a stock of 1.
- [x] Reservations expire after 15 minutes and stock returns — and availability filters on
      `expiresAt` directly, so an expired hold stops blocking stock even if Redis and the
      sweeper have both failed
- [x] The sweeper releases reservations Redis lost — `POST /api/v1/internal/sweep-reservations`,
      guarded by `CRON_SECRET` with a constant-time compare. Verified: no secret 403, wrong
      secret 403, right secret 200. It refuses to run at all when the secret is unset, since
      an open endpoint that drops reservations is a denial-of-service vector.

Deliberately built ahead of P3-02, because it needs no PayMongo credentials and it is the
riskiest code in the system. Stock is reserved, never decremented — the decrement happens on
the paid webhook through the inventory ledger, per docs/03.

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
- [x] Illegal transitions throw; the admin UI only offers legal ones — the three axes are
      explicit maps in `order.service.ts`, and `allowedNext()` is what any UI renders rather
      than a hardcoded list. A test walks every listed transition and asserts the checker
      agrees, so the two halves cannot drift.
- [ ] Confirmation, shipped, delivered, and refunded emails all send and render on mobile —
      **not done.** The triggers exist and fire (adding tracking queues the shipped email
      exactly once, verified), but `email.service.ts` is still the logging stub: there is no
      Resend key, so nothing sends and no rendering has been checked on any device.
- [x] Customer timeline shows public events only — internal notes live on the same table and
      are filtered out at the query, verified against the seeded "item inspected on return,
      resalable" note
- [x] Guest order tracking works with order number + email — verified live. A wrong email
      returns byte-identical output to a nonexistent order, so the endpoint cannot be used to
      probe which order numbers are real. Rate limited to 5/min.

Order lifecycle and tracking were built without PayMongo. The paid-webhook side of this
ticket belongs with P3-05.

---

## Phase 4 — Operations

**P4-01 · Admin orders.** List, detail, transitions, tracking, packing slip, CSV export.
- [~] Adding a tracking number sends the shipped email exactly once — the **exactly once**
      half is verified live: saving tracking ships the order and writes one `shipped` event,
      and correcting the number afterwards updates it without a second one. The **sends**
      half is still blocked on a Resend key; `email.service.ts` remains the logging stub.
- [~] Packing slip prints cleanly on A4 — `@page { size: A4; margin: 14mm }`, controls hidden
      with `no-print`, and rows guarded with `break-inside: avoid`. **Nothing has actually
      been printed**, so "cleanly" is unverified — someone needs to send one to a real
      printer. Prices are hidden by default (`?prices=true` shows them): a slip left in a box
      should not double as an invoice.

Also in this ticket: the admin now reads live data everywhere and `lib/admin/fixtures.ts` is
deleted. Filters, search, transitions, tracking and CSV export all verified against the
running app. The export is filter-aware, carries a UTF-8 BOM so Excel renders the peso sign,
and prefixes `=`, `+`, `-` and `@` so a spreadsheet cannot execute a customer-supplied value.

**P4-02 · Refunds.** Full and partial, with optional restock.
- [ ] Refund calls PayMongo and reconciles on the webhook
- [ ] Restock writes `refund_return` movements
- [ ] `refundedCents` can never exceed `totalCents`
- [ ] Requires typed confirmation; always writes an `AuditLog`

**P4-03 · Inventory.** Stock list, low-stock filter, manual adjustment, movement history.
- [x] Adjustment without a reason is rejected — verified live, 422. So are a zero change and
      anything that would drive physical stock below zero.
- [x] Movement history shows actor, delta, reason, and running balance — `balanceAfter` is
      stored per row rather than recomputed, so the history reads correctly even paginated.
      System movements show "System" rather than a person: a sale is not somebody's decision.
- [x] A reconciliation command rebuilds `stockQty` from the ledger and reports drift —
      `pnpm db:reconcile`, `--repair` to write. Proved end to end: a bare `UPDATE` behind the
      ledger's back was detected (999 vs 29, +970), reported without changing anything,
      exited 1 so a cron can alert, then repaired to 29 on request, and a second pass was
      clean.

The command reports by default and only writes when asked. A silent repair would hide the bug
that caused the drift — and drift means something wrote stock outside a movement transaction,
which is the thing worth finding.

**P4-04 · Customers and members.** Profiles, order history, lifetime value, member verification.
- [x] Member verification is admin-only and audited — `requireAdmin`, not `requireStaff`, because
      member status grants a store-wide discount and is therefore a money decision. Verified
      over real HTTP: staff get 403 on both POST and DELETE, the staff view renders "Only an
      admin can change member status" and no withdraw button, and every change writes an
      audit row (`user.verify_member` / `user.revoke_member`) with actor and IP.
- [~] Admin-assisted recovery works per `docs/07` and never exposes a password. Walked end to
      end against the dev server: public form → `4 of 4 match` evidence page → admin approval
      (staff refused) → confirmation link emailed to the **new** address only → customer
      confirms → email moved, `sessionsRevokedAt` set, link burned on replay. The password
      hash was byte-identical before and after, and `getCustomer` never selects it at all.
      Audit rows credit approval to the admin and confirmation to the customer, since two
      different people acted. **Two gaps:** `docs/07` also wants an SMS to the verified phone
      on step 4 and there is no SMS transport yet; and the review screen lives at
      `/admin/recovery/:id` rather than the doc's `/admin/customers/:id/recovery`, because a
      request that matches no account has no customer to hang off — the unmatched ones are
      exactly the ones an admin most needs to see.

**P4-05 · Coupons.** CRUD plus enforcement.
- [x] Usage caps hold under concurrent redemption. The cap is now settled in two places, both
      under a `SELECT ... FOR UPDATE` on the coupon row, and both proved against real MySQL:
      `claimCoupon` inside the checkout transaction (so two people spending the last use of a
      single-use code resolve to one), and `redeemCoupon` on payment (so ten simultaneous
      redemptions leave `usedCount` exact, not short). A **control test** runs the same
      scenario without the lock and is expected to break — if it ever passes, the suite has
      stopped testing anything. `(couponId, orderId)` is unique, so a replayed webhook counts
      once even if invariant I6's own idempotency check is wrong.
- [x] Admin CRUD, audited. Deleting a coupon that has been used deactivates it instead — the
      redemption rows are the record of what it gave away and the schema cascades.
- Three bugs found and fixed while building this, all pre-existing:
  - `redeemCoupon` had **no caller at all**, so `usedCount` never moved and every capped code
    was effectively unlimited. It is now wired to the payment path's contract, ready for the
    webhook in P3-04.
  - The checkout quote carried `couponCode` even when validation had rejected the code, so an
    order recorded a coupon that discounted nothing — which then read as a use to both the cap
    and the webhook.
  - `usedCount` only moves on payment, so between checkout and the paid webhook a single-use
    code read as unused to every simultaneous buyer. `claimCoupon` counts unpaid-but-recent
    orders too, bounded by the same 15-minute window stock reservations get, so an abandoned
    basket releases the code rather than burning it.
- Deliberate: going over the cap at redemption does **not** throw. By then PayMongo has the
  money and the discount is on the order; it returns `over_cap` so the caller can flag it.

**P4-06 · Dashboard, content, settings, audit log.**
- [x] Dashboard figures reconcile against a manual query. They did not before: "awaiting
      action" and "low stock" were the `.length` of a list capped at `take: 8`, so both read 8
      no matter how deep the queue was, and sales showed gross rather than net of refunds.
      Extracted to `dashboard.service.ts` where every figure is counted rather than inferred,
      and each test recomputes its expectation a second way instead of asserting a constant.
      Lists on the page are now explicitly samples and say "See all 23" when truncated. Top
      products this week added, ranked by units rather than revenue — it is a restocking
      question, and revenue puts one windbreaker above forty bags of coffee.
- [x] Audit log is filterable by actor, entity, action and date, with cursor paging. Dates are
      Manila calendar days converted to UTC instants at the boundary; filtering on the raw
      string would silently drop the first eight hours of every day.
- [x] Settings are admin-only, declared rather than open key-value, range-checked, and audited
      one field at a time so one change is one entry.
- [x] Content: banner CRUD with a schedule, and the announcement bar wired into the shop.
- **A live PayMongo key was leaking into the page source.** `listSettings` masked the value
  after reading it, which is not enough: Next 15's dev build ships the resolved value of every
  awaited promise to the browser for its performance timeline, so the `findMany()` that
  selected the column put the plaintext key into the HTML. Fixed by never selecting it — two
  queries, and the secret column is absent from the one covering secret keys. A test asserts
  the emitted SQL, not just the returned shape. Also fixed `homeShelves` ignoring
  `startsAt`/`endsAt`, so a scheduled banner appeared immediately and an expired one never
  stopped.

**P4-07 · Reviews and wishlist.**
- [x] Only verified purchasers can review; reviews require moderation before display. There was
      no way to submit a review at all before this — the display path filtered on `approved`
      correctly, but nothing wrote one. Eligibility checks the order items (the record that the
      purchase happened) plus `docs/07`'s verified-email rule, and `orderId` is stamped from
      that check rather than taken from the request, so the "verified purchase" badge means
      what it says. Verified over HTTP: guest 401, signed-in non-purchaser 403, unverified
      email 403, second review 422, and the pending review absent from **both** the product
      page and the product API until an admin published it — then gone again when unpublished.
- [~] Back-in-stock notification fires on restock. Proven end to end: subscribing while in
      stock is refused, a guest can subscribe once it is empty, the restock fires exactly one
      email, and a second restock fires none. **The transport is still the P3-06 stub**, so
      what is verified is that the right recipients are claimed on the right event and the
      mailer is called — not that mail leaves the building.
- New `StockSubscription` table. Keyed on email rather than userId alone, because the person
  most likely to want this is the one who just found the item out of stock, and making them
  register first loses the sale we are recovering.
- The firing rule is a **crossing**, not a level: alerts go out when availability goes from
  nothing to something. A level check would email everyone again on the second delivery of the
  week. A control test asserts a top-up that never crossed zero fires nothing.
- Two concurrency bugs found and fixed while building this, both pre-existing in shape:
  - `claimAlertsFor` read-then-stamped without a lock, so two restocks landing together both
    handed out the same subscriber — one person, two emails. Now takes a row lock on the
    variant; tested at ten-way concurrency.
  - `adjustStock` was a read-modify-write on `stockQty` with no lock, so two admins adjusting
    at once lost one adjustment while keeping its movement row — drift arriving from a bug
    rather than from reality, which is what `reconcileStock` exists to catch.
- Also fixed: `getProductDetail` averaged the rating over the twenty reviews it displayed, so
  a popular product was rated on its newest twenty and `ratingCount` sat at 20 forever.

---

## Phase 5 — Launch readiness

**P5-01 · Compliance pages.** Terms, privacy policy, returns policy, DPA consent, deletion request flow.
- [x] `/terms`, `/privacy`, `/returns` exist. The footer had been linking to all three since
      P2-01 and all three were 404s. Each carries a last-reviewed date at the top.
- [~] **Not reviewed by a lawyer.** The content describes what the system actually does — the
      privacy page's retention and erasure sections match `privacy.service` line for line, and
      "we never see your card" is true because docs/06 uses hosted checkout and there is no card
      table. That is the part only the code can get right; the language still needs a
      professional read before launch. **This is the outstanding item on this ticket.**
- [x] DPA consent was already captured at registration (P1-05), unticked by default and separate
      from marketing. It now links to the policy, which docs/07 asked for. The link sits beside
      the label rather than inside it: a link inside a `<label>` also toggles the checkbox, so
      agreeing would be a side effect of reading what you are agreeing to.
- [x] Erasure request flow, `POST /me/deletion-request` per docs/04, with an admin-only review
      screen. Verified over HTTP end to end on a throwaway account: no personal data left in any
      table, the sale intact with its order number, amount and paid date, the frozen delivery
      address replaced, and nothing leaked into the audit log.
- The design decision worth arguing with before changing: **erasure anonymises the person, it
  does not delete their orders.** BIR requires the invoice trail, and a shop that can erase its
  own sales records has a worse problem than a privacy one. The customer is shown exactly what
  stays and why before they confirm, and those terms are frozen onto the request so a later
  policy change cannot rewrite what they agreed to.
- Staff and admin accounts are refused: their id is referenced by every audit row they wrote,
  and anonymising an actor is how an audit log stops answering "who did this".

**P5-02 · SEO and metadata.** Product structured data, sitemap, robots, OG images, canonical URLs.
- [x] All of it was missing: no `metadataBase`, no robots, no sitemap, no canonicals, no
      structured data, no OG images.
- [x] **Verified against a real production build**, not just dev — `NEXT_PUBLIC_BASE_URL` set to
      a live domain, `pnpm build`, `pnpm start`. That is the only way to prove the environment
      gate actually opens: everything is `noindex` on localhost by design, and a bug there would
      have shipped a permanently unindexable shop with nothing on screen to show for it.
- [x] Structured data: `Product` with `Offer`/`AggregateOffer`, `BreadcrumbList`, `Organization`,
      `WebSite`. Two honesty rules, both tested: **no `aggregateRating` until a review is
      approved** ("0 out of 5" and "no rating" are different claims), and **the regular price,
      never the member price** — member pricing needs a verified membership, so quoting it in
      search results would advertise a number most people cannot get.
- [x] Canonicals collapse filters and sort onto the plain URL and keep `page`. Search results
      are `noindex, follow` — they are generated from someone else's query and would otherwise
      create an unbounded set of thin pages.
- [x] OG images generated with `next/og` rather than served as files: there is no media pipeline
      yet (P1-06 blocked), and a drawn card cannot go stale against the design tokens. Both the
      default and the per-product card confirmed to render as real PNGs over HTTP.
- Caught during verification: `pageMetadata` set `openGraph.images` unconditionally, which
  **overrides** Next's `opengraph-image.tsx` file convention — every product was advertising the
  generic site card. Only visible by fetching the page and reading the tag.

**P5-03 · Security pass.**
- [x] Rate limits on every sensitive endpoint. **None of the 22 admin routes had one.** Folded
      into `requireStaff`/`requireAdmin` rather than added per handler, and `request` is a
      required parameter so the compiler names every call site — "remember to also rate limit
      it" does not survive the twenty-third route. Keyed on the actor id, not the IP: the role
      check already stops strangers, so the threat is a borrowed staff session.
- [x] No secrets in the repo; `.env` gitignored. Checked working tree **and** history — `.env`
      was never committed and no live-shaped key appears in any commit.
- [x] CSP, HSTS and security headers set. Nonce-based CSP, not `'unsafe-inline'`: a policy that
      permits arbitrary inline script buys nothing and would let this box be ticked for free.
      HSTS is production-only, since pinning localhost to HTTPS breaks a dev machine until the
      browser is cleared.
- [x] Admin two-factor enabled. TOTP (RFC 6238) written here rather than added as a dependency,
      and checked against the RFC's own published test vectors — a stronger guarantee than
      trusting an unaudited package with the thing between a stolen admin password and the shop.
      Ten single-use recovery codes, stored hashed and shown once.
- [x] Dependency audit clean. Two transitive packages (`postcss`, `sharp`) pinned past published
      advisories via `pnpm-workspace.yaml` overrides. `pnpm audit` now exits 0.
- [x] No endpoint trusts a client-supplied price, quantity or role. Swept every request schema:
      no role or member flag is accepted anywhere, and the only two money values a client can
      send are `seenSubtotalCents` (compared, never used to price) and the shipping quote's
      `subtotalCents` (display only). Both now have tests proving checkout ignores them.
      Quantity **is** client-supplied by design — docs/CLAUDE.md says the cart payload is
      variant ids and quantities and nothing more.
- **A privilege escalation was introduced and caught during this ticket.** Adding the CSP nonce
  meant passing a callback to `auth()` in middleware, which *replaces* the `authorized` gate
  rather than running after it — so for the length of that mistake staff could open
  `/admin/settings` and `/admin/audit-logs`. The API refused them because route handlers
  re-check server-side; the pages did not, because they never had. Fixed on both sides: the
  gate is now explicit in the middleware callback, and all five admin-only pages check the role
  themselves. `guarded-pages.test.ts` fails the build if a new one does not.

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
