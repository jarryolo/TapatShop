import { PrismaClient } from "@tapatshop/db";

/**
 * The one Prisma client for the whole app.
 *
 * Next's dev server reloads modules on every edit. Without the global cache below, each
 * reload constructs another client and opens another connection pool, and MySQL starts
 * refusing connections after a few dozen saves. In production the module is evaluated once,
 * so the global is never used.
 *
 * All database access goes through this. No route handler or component constructs its own.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Set PRISMA_LOG_QUERIES=true to print every statement.
 *
 * This is how the "no N+1 queries" rule in docs/02 gets checked rather than assumed: load a
 * catalog page, count the statements, and confirm the number does not grow with the number
 * of products on it. Off by default — it is extremely noisy.
 */
const logQueries = process.env.PRISMA_LOG_QUERIES === "true";

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logQueries
      ? ["query", "warn", "error"]
      : process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
