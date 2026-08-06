# TapatShop

Ecommerce store for a brotherhood of Christian businessmen and professionals in the
Philippines. Single store: one catalog, one admin team, one payout account.

Next.js 15 · TypeScript strict · MySQL 8 · Prisma · Auth.js · Redis · Tailwind · PayMongo.

## Local setup

1. Install [Node 22+](https://nodejs.org), [pnpm](https://pnpm.io/installation)
   (`npm install -g pnpm`), and [Docker Desktop](https://docs.docker.com/desktop/).
2. `pnpm install`
3. Copy the environment file: `cp .env.example .env` (PowerShell:
   `Copy-Item .env.example .env`). The defaults already match the Docker services below —
   only the third-party keys are blank.
4. `pnpm docker:up` — starts MySQL on 3306, Redis on 6379, and MinIO on 9000 with its
   console on 9001. First boot creates the `tapatshop` and `tapatshop_shadow` databases and
   the media bucket.
5. `pnpm db:migrate` then `pnpm db:seed` — creates the tables and fills them with a store
   worth reviewing: 12 products, 7 orders across the status combinations, and a working
   inventory ledger. Sign in as any seeded email with the password `tapatshop123`.
6. `pnpm dev` — the app is at http://localhost:3000, and http://localhost:3000/api/v1/health
   should answer `{"status":"ok"}`.
7. `pnpm typecheck && pnpm lint && pnpm test` — run this before declaring any ticket done.

**Already running MySQL and Redis yourself?** Skip step 4 and run
`mysql -u root -p < scripts/setup-local-mysql.sql` once instead. It creates the same two
databases and the same `tapat` user, so nothing else changes.

`pnpm db:reset` drops everything, re-runs the migrations, and re-seeds. Use it whenever the
local data gets into a state you do not trust.

To receive PayMongo webhooks locally you will need a tunnel — see
`docs/06-payments-paymongo.md`. Not needed before Phase 3.

## Scripts

| Command                             | What it does                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Next.js dev server                                                                                                                                                      |
| `pnpm build` / `pnpm start`         | Production build and serve. Stop `pnpm dev` first — they share `apps/web/.next`, and building over a running dev server yields a bundle that only fails at request time |
| `pnpm typecheck`                    | `tsc --noEmit` across every workspace package                                                                                                                           |
| `pnpm lint` / `pnpm lint:fix`       | ESLint across the repo                                                                                                                                                  |
| `pnpm test` / `pnpm test:watch`     | Vitest                                                                                                                                                                  |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                                                                |
| `pnpm docker:up` / `docker:down`    | Start and stop local services                                                                                                                                           |
| `pnpm docker:reset`                 | Stop and **delete the volumes** — wipes local data                                                                                                                      |
| `pnpm docker:logs`                  | Tail service logs                                                                                                                                                       |

## Layout

```
apps/web/            Next.js app — app/, components/, lib/
  app/api/v1/        REST API. The contract the future mobile app consumes.
packages/db/         Prisma schema, migrations, seed
packages/shared/     Types and Zod schemas shared with mobile
docker/              Local service definitions
docs/                The specification
```

## Documentation

| File                               | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `CLAUDE.md`                        | Always-loaded rules. Conventions, invariants, things that must never happen. |
| `docs/01-product-spec.md`          | What we're building, for whom, and what "done" means.                        |
| `docs/02-architecture.md`          | Stack, repo layout, environment, coding conventions.                         |
| `docs/03-data-model.md`            | Schema rationale and the invariants the code must uphold.                    |
| `packages/db/prisma/schema.prisma` | The actual schema. Source of truth for the data layer.                       |
| `docs/04-api-spec.md`              | Every endpoint, with request/response shapes.                                |
| `docs/05-design-system.md`         | Tokens, components, layout rules.                                            |
| `docs/06-payments-paymongo.md`     | Checkout flow, webhook handling, order state machine.                        |
| `docs/07-auth-and-recovery.md`     | Auth providers, account linking, lockout recovery.                           |
| `docs/08-build-plan.md`            | Sequenced tickets with acceptance criteria. **Start here.**                  |
| `.env.example`                     | Every environment variable, documented.                                      |

## How the work runs

Work `docs/08-build-plan.md` one ticket at a time, in order. One ticket, one review, one
commit. Do not start a ticket whose dependencies aren't merged, and do not ask for a whole
phase in one go.

## Decisions (P0-01, resolved 2026-08-06)

1. **Single store.** No vendor role, no per-vendor payouts, no split settlement.
2. **No cash on delivery in v1.** PayMongo prepaid only. Revisit after launch — it means a
   second order state machine, courier remittance reconciliation, and an abandonment policy.
3. **Member pricing is a store-wide percentage**, held in the `member_discount_percent`
   setting. Rules and rounding in `docs/01-product-spec.md`.
