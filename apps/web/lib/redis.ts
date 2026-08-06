import Redis from "ioredis";

/**
 * The one Redis connection. Sessions, rate limits, and stock reservations all share it.
 *
 * Same dev-reload guard as lib/db.ts: without it every hot reload opens another connection
 * and Redis eventually refuses new ones.
 *
 * `lazyConnect` means importing this module does not open a socket. Route handlers that
 * never touch Redis — most of the catalog — should not pay for a connection, and the build
 * should not need a running Redis to prerender a page.
 */

const globalForRedis = globalThis as unknown as { redis?: Redis };

function create(): Redis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";

  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    // Fail fast. A rate limiter that hangs for 30 seconds is worse than one that errors.
    connectTimeout: 3000,
  });
}

export const redis: Redis = globalForRedis.redis ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
