/**
 * The data layer. Prisma schema, migrations, and seed live in this package.
 *
 * This re-export is the only place the generated client path appears. Application code
 * imports `PrismaClient` and the model types from `@tapatshop/db`, and reaches an actual
 * connected instance through `apps/web/lib/db.ts` — never by constructing one itself.
 * See docs/CLAUDE.md.
 */

export * from "../generated/client/index.js";
export { PrismaClient, Prisma } from "../generated/client/index.js";
