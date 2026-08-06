# 02 — Architecture

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | Server Components for catalog pages |
| API | Route handlers at `/api/v1/*` | Same contract serves web and the future mobile app |
| Database | MySQL 8, InnoDB, `utf8mb4_0900_ai_ci` | Self-hosted per requirement |
| ORM | Prisma | Migrations are the only way schema changes |
| Auth | Auth.js (NextAuth v5), JWT sessions | Credentials + Google |
| Cache / queue | Redis | Sessions, rate limits, stock reservations, job queue |
| Media | MinIO (S3-compatible, self-hosted) | Served through `next/image` |
| Email | Resend, or SMTP fallback | Transactional only |
| Payments | PayMongo Checkout Sessions + webhooks | See `docs/06` |
| Styling | Tailwind, hand-built component layer | No UI kit |
| Validation | Zod | Shared between web and mobile |
| Hosting | Docker Compose on a PH VPS, Nginx, Cloudflare | 4 vCPU / 8 GB to start |
| Errors | Sentry | Both server and client |

## Why API-first

The client wants a mobile app. If business logic lives in Server Actions, the mobile app
needs a rewrite. So: every mutation that the mobile app will eventually need is a route
handler under `/api/v1/`. Server Actions are permitted only for web-only admin forms.

## Repo layout

```
tapatshop/
├─ apps/
│  ├─ web/                  Next.js app
│  │  ├─ app/
│  │  │  ├─ (shop)/         Storefront routes
│  │  │  ├─ (account)/      Customer account, auth-gated
│  │  │  ├─ admin/          Admin portal, role-gated in middleware
│  │  │  └─ api/v1/         REST API — the mobile contract
│  │  ├─ components/
│  │  │  ├─ ui/             Primitives: Button, Input, Card, Badge, Sheet
│  │  │  ├─ shop/           ProductCard, CartDrawer, VariantPicker
│  │  │  └─ admin/          DataTable, StatCard, StatusPill
│  │  ├─ lib/
│  │  │  ├─ db.ts           Prisma client singleton
│  │  │  ├─ auth.ts         Auth.js config
│  │  │  ├─ redis.ts
│  │  │  ├─ services/       ALL business logic lives here
│  │  │  ├─ validators/     Zod schemas
│  │  │  └─ utils/          money.ts, slug.ts, format.ts
│  │  └─ middleware.ts      Route protection
│  └─ mobile/               Expo app — phase 7, not yet
├─ packages/
│  ├─ db/                   Prisma schema, migrations, seed
│  └─ shared/               Types + Zod schemas shared with mobile
├─ docker/
│  ├─ docker-compose.yml
│  └─ nginx/
└─ docs/
```

## Service layer

Every meaningful operation is a function in `lib/services/`. Route handlers do three
things only: validate input, call a service, shape the response.

```
services/
  cart.service.ts        addItem, updateQty, removeItem, mergeGuestCart, priceCart
  checkout.service.ts    validateCart, reserveStock, createOrder, releaseReservation
  order.service.ts       transition, addTracking, cancel, refund
  inventory.service.ts   adjust, recordMovement, lowStockList
  product.service.ts     list, detail, search, upsert
  payment.service.ts     createCheckoutSession, handleWebhook, refund
  auth.service.ts        register, linkProvider, requestReset, resetPassword
  email.service.ts       queue and send transactional mail
  audit.service.ts       log
```

Services take a Prisma transaction client as an optional first argument so they compose:
`createOrder(tx, ...)`. Anything that touches stock or money must run inside a transaction.

## Route protection

`middleware.ts` gates by path prefix:

- `/admin/*` → requires role `admin` or `staff`; `/admin/settings/*` and `/admin/staff/*`
  require `admin`
- `/account/*` → requires any authenticated session
- `/api/v1/admin/*` → same rules as `/admin/*`
- Everything else is public

Middleware checks the JWT only. Every admin route handler must **also** re-check the role
server-side. Middleware is a convenience, not a security boundary.

## Caching

- Product and category pages: `revalidate = 300`, plus tag-based revalidation on product
  update (`revalidateTag('product:'+id)`)
- Cart, checkout, account, admin: never cached, `dynamic = 'force-dynamic'`
- Redis for stock reservations (`resv:{variantId}:{cartId}`, TTL 900s) and rate limits

## Environments

Three: `local` (Docker Compose), `staging` (PayMongo test keys, seeded data, robots
noindex), `production`. Staging must exist before ticket P3-01 — you cannot safely test
webhooks otherwise. Use a tunnel (cloudflared) to receive PayMongo webhooks locally.

## Observability and ops

- Sentry on server and client
- Structured JSON logs; never log full webhook payloads containing PII
- Uptime check on `/api/health`
- Nightly `mysqldump` to off-server storage, with a **restore rehearsed before launch**
- App's MySQL user has no `DROP` privilege; migrations run as a separate user

## Performance targets

LCP under 2.5s on 4G for the home and product pages. Catalog pages must not issue N+1
queries — check with Prisma query logging before closing any catalog ticket.
