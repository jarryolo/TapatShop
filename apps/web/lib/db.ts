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

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
