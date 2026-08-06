# TapatShop — Claude handover bundle

This is the complete build specification for TapatShop.com. It is written to be handed
to Claude Code (or any competent developer) with no additional context.

## How to use this

1. Create an empty git repo and copy this entire bundle into its root.
2. Open Claude Code in the repo root. `CLAUDE.md` loads automatically on every turn.
3. Work through `docs/08-build-plan.md` one ticket at a time, in order.
4. Say: *"Read CLAUDE.md and docs/08-build-plan.md. Implement ticket P1-01. Stop when its
   acceptance criteria pass and I'll review before you continue."*

Do not ask for a whole phase in one go. One ticket, one review, one commit.

## What's here

| File | Purpose |
|---|---|
| `CLAUDE.md` | Always-loaded rules. Conventions, invariants, things that must never happen. |
| `docs/01-product-spec.md` | What we're building, for whom, and what "done" means. |
| `docs/02-architecture.md` | Stack, repo layout, environment, coding conventions. |
| `docs/03-data-model.md` | Schema rationale and the invariants the code must uphold. |
| `packages/db/prisma/schema.prisma` | The actual schema. Source of truth for the data layer. |
| `docs/04-api-spec.md` | Every endpoint, with request/response shapes. |
| `docs/05-design-system.md` | Tokens, components, layout rules. |
| `docs/06-payments-paymongo.md` | Checkout flow, webhook handling, order state machine. |
| `docs/07-auth-and-recovery.md` | Auth providers, account linking, lockout recovery. |
| `docs/08-build-plan.md` | Sequenced tickets with acceptance criteria. **Start here.** |
| `.env.example` | Every environment variable, documented. |

## Open decisions

These must be answered before P1 starts. They change the schema.

1. **Single store or member marketplace?** This bundle assumes single store — the
   brotherhood operates one catalog and one PayMongo account. A marketplace needs a
   vendor role, per-vendor payouts, and split settlement.
2. **Cash on delivery?** Common in PH. Not in scope here. Adding it later means a second
   order state machine and a COD-abandonment policy.
3. **Member-only pricing?** Schema supports it (`users.member_no`, `products.member_price_cents`)
   but the business rules are unspecified.
