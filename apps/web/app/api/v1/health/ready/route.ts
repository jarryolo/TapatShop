import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

/**
 * Readiness: can this process actually serve a request that does real work?
 *
 * Distinct from `/api/v1/health`, which answers "is the process up" and deliberately touches
 * nothing. Both are needed and they page different people — a liveness failure means restart
 * the app, a readiness failure means the app is fine and something it depends on is not.
 *
 * This exists because the difference stopped being theoretical. During P5-04 the machine
 * rebooted, a second MySQL install won port 3306, and every page returned 500 for hours —
 * while `/api/v1/health` returned 200 the whole time, because it is not allowed to fail for
 * that reason. docs/02 puts the uptime check on `/health` alone, so nothing would have paged.
 *
 * Returns 503 when degraded, so an uptime checker treats it as down without having to parse
 * the body. The body still says which dependency failed, because "down" is not an answer
 * anyone can act on at 2am.
 */
export const dynamic = "force-dynamic";

/** Long enough to cross a loaded connection pool, short enough not to hang the checker. */
const TIMEOUT_MS = 3_000;

type Check = { name: string; ok: boolean; ms: number; error?: string };

/**
 * The one line worth waking someone for, never the whole error.
 *
 * A Prisma failure carries the connection string, and this endpoint is reachable by whatever
 * is polling it — not somewhere to publish credentials. But some detail has to survive:
 * "degraded" alone does not say whether to restart a service or a server.
 *
 * Prisma puts its cause *last*, after a boilerplate opener and a code frame. Two earlier
 * attempts took the first line and got a blank and then `Invalid prisma.$queryRaw()
 * invocation:` — both technically the first line, neither any use at 2am.
 */
export function reasonFrom(error: unknown): string {
  if (!(error instanceof Error)) return "failed";

  const meaningful = error.message
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        // Prisma's opener, and the code frame it prints under it.
        !line.endsWith("invocation:") &&
        !/^→?\s*\d+\s/.test(line) &&
        !/^[|~^]/.test(line)
    );

  // Never echo anything that looks like a connection string, whatever line it came from.
  const chosen = meaningful.at(-1) ?? "failed";
  return chosen.replace(/\b\w+:\/\/[^\s"]+/g, "[redacted]").slice(0, 140);
}

async function timed(name: string, probe: () => Promise<unknown>): Promise<Check> {
  const started = Date.now();

  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      ),
    ]);
    return { name, ok: true, ms: Date.now() - started };
  } catch (error) {
    return { name, ok: false, ms: Date.now() - started, error: reasonFrom(error) };
  }
}

export async function GET() {
  const checks = await Promise.all([
    // The cheapest query that still proves a connection was established and authenticated.
    timed("mysql", () => db.$queryRaw`SELECT 1`),
    timed("redis", () => redis.ping()),
  ]);

  const ready = checks.every((check) => check.ok);

  return Response.json(
    {
      status: ready ? "ready" : "degraded",
      checks: Object.fromEntries(
        checks.map((check) => [
          check.name,
          { ok: check.ok, ms: check.ms, ...(check.error ? { error: check.error } : {}) },
        ])
      ),
    },
    { status: ready ? 200 : 503 }
  );
}
