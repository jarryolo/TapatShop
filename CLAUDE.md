# TapatShop — project rules

Ecommerce store for a brotherhood of Christian businessmen and professionals in the
Philippines. Single-store model: one catalog, one admin team, one payout account.

Read `docs/02-architecture.md` before writing code. Read `docs/08-build-plan.md` to know
what to work on. Never start a ticket that isn't the next unblocked one.

## Stack

Next.js 15 App Router · TypeScript strict · MySQL 8 (self-hosted) · Prisma · Auth.js ·
Redis · Tailwind · PayMongo · Docker Compose.

## Hard invariants

These are not preferences. Breaking any of them is a bug even if tests pass.

1. **Money is integer centavos.** Every monetary column and variable is an `Int` named
   `*_cents`. No floats, no `Decimal`, no string math. Format only at the render layer.
2. **Never trust client prices.** Checkout recomputes every line total server-side from
   the database. The cart payload from the browser is a list of variant IDs and
   quantities, nothing more.
3. **Stock changes only via `inventory_movements`.** Write a movement row inside a
   transaction and update `product_variants.stock_qty` in the same transaction.
   `stock_qty` is a derived cache; the movement ledger is the truth.
4. **Order line items are snapshots.** Copy name, sku, price, and image URL onto
   `order_items` at purchase time. Never join a historical order to live product data.
5. **The webhook is the source of truth for payment.** The browser redirect back from
   PayMongo confirms nothing. An order becomes paid only when a verified webhook says so.
6. **All webhooks are idempotent.** Check `webhook_events` by provider event id before
   processing. Return 200 quickly; do the work after.
7. **Every admin mutation writes an `audit_logs` row.** Actor, entity, before, after.
8. **Admins can never read or set a user's password**, and never see full payment card
   data. There is no such data in our database.

## Conventions

- Server Components by default. `"use client"` only for components with state or handlers.
- All input validated with Zod at the route boundary. Share schemas between web and mobile.
- Route handlers live at `app/api/v1/*`. They are the contract for the future mobile app —
  never put business logic in a Server Action that the mobile app would also need.
- Business logic lives in `lib/services/*`, not in route handlers or components.
- Errors: return `{ error: { code, message } }` with a proper HTTP status. Never leak
  stack traces or Prisma errors to the client.
- Database access only through `lib/db.ts`. No raw SQL unless there's a comment saying why.
- File names kebab-case. Components PascalCase. Env vars SCREAMING_SNAKE.
- Sentence case in all UI copy. No exclamation marks. No "please".

## Currency and locale

PHP only. Peso sign, comma thousands separator, two decimals on display: `₱1,234.50`.
Addresses use the PH hierarchy: region → province → city/municipality → barangay.
Timezone is `Asia/Manila` for all display; store UTC.

## Testing

- Every service function in `lib/services/` needs unit tests.
- Checkout, stock reservation, and webhook handling need integration tests. These are the
  three places this system will break first — test concurrent orders on the last unit.
- Run `pnpm typecheck && pnpm lint && pnpm test` before declaring a ticket done.

## Definition of done

A ticket is done when: acceptance criteria pass, types check, lint passes, tests pass,
no `console.log` left, and the change is a single focused commit with a clear message.

## Do not

- Do not install a UI kit. The design system in `docs/05-design-system.md` is hand-built.
- Do not add a payment provider other than PayMongo.
- Do not build a native card form. PayMongo hosted checkout only.
- Do not store images in the database or the repo. They go to S3-compatible storage.
- Do not add dependencies without saying why in the commit message.
- Do not refactor code outside the ticket's scope.
