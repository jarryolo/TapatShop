import { redis } from "./redis";

/**
 * Redis-backed fixed-window rate limiting. Limits are in docs/04-api-spec.md.
 *
 * Fixed window rather than sliding: it is one INCR plus one EXPIRE, it needs no stored
 * history, and the worst case is a caller getting 2x the limit across a window boundary.
 * For "5 login attempts a minute" that is an acceptable trade; for anything guarding money
 * it would not be.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Named limits, from docs/04. Keeping them here stops each route inventing its own.
 *
 * Note how these are keyed: docs/04 says login is "5/min per email + IP", meaning the pair,
 * not two independent buckets. That distinction is not pedantic. A large share of Philippine
 * traffic arrives through carrier-grade NAT and shared office connections, so a bare per-IP
 * limit of 5 means a handful of customers on the same network lock each other out of their
 * own accounts. Keying on the pair limits an attacker working one account from one place,
 * and `ipCeiling` below is what catches the spraying case instead.
 */
export const LIMITS = {
  login: { limit: 5, windowSeconds: 60 },
  register: { limit: 5, windowSeconds: 60 },
  passwordReset: { limit: 3, windowSeconds: 3600 },
  /**
   * Its own bucket rather than sharing passwordReset's.
   *
   * Both are keyed per IP, and everyone in one office or behind one carrier NAT shares an
   * IP. Sharing a bucket would mean a colleague's three password resets locked out the one
   * person who has actually lost their account — the case with no other way in.
   */
  accountRecovery: { limit: 3, windowSeconds: 3600 },
  otpRequest: { limit: 3, windowSeconds: 3600 },
  otpVerify: { limit: 3, windowSeconds: 900 },
  orderTracking: { limit: 5, windowSeconds: 60 },
  checkoutSession: { limit: 10, windowSeconds: 60 },
  searchSuggest: { limit: 30, windowSeconds: 60 },
  /** A lookup, not a credential attempt, so it does not spend login attempts. */
  signInMethods: { limit: 10, windowSeconds: 60 },
  /**
   * The per-IP backstop applied to every rate-limited endpoint, on top of the specific
   * limit. This is what stops one host trying one password against a thousand accounts —
   * the per-pair limits above never would.
   */
  ipCeiling: { limit: 60, windowSeconds: 60 },
  default: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Feeds the Retry-After header. */
  retryAfter: number;
}

/**
 * Consumes one unit against `key`.
 *
 * **Fails open.** If Redis is unreachable the request is allowed. That is a deliberate
 * trade: an outage that takes down Redis should not also take down the login page. It means
 * a Redis outage removes rate limiting, so the outage itself needs alerting — see docs/02.
 * Anywhere that fails *closed* would need a different function and a comment saying why.
 */
export async function rateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;

  try {
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }

    const count = await redis.incr(redisKey);

    // Only the request that created the key sets the expiry, so the window is fixed rather
    // than sliding forward on every hit — otherwise a steady stream of requests would keep
    // extending the window and the caller would never be let back in.
    if (count === 1) {
      await redis.expire(redisKey, rule.windowSeconds);
    }

    const ttl = await redis.ttl(redisKey);
    const retryAfter = ttl > 0 ? ttl : rule.windowSeconds;

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfter,
    };
  } catch {
    return { allowed: true, remaining: rule.limit, retryAfter: 0 };
  }
}

/**
 * Builds a rate limit key.
 *
 * Identifiers are lowercased so "Joel@Example.com" and "joel@example.com" share a bucket —
 * otherwise case variation is a free way around a per-email limit.
 */
export function rateLimitKey(scope: string, ...parts: (string | null | undefined)[]): string {
  const identifiers = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return `${scope}:${identifiers.map((p) => p.toLowerCase()).join(":")}`;
}

/** The client IP, from the proxy headers Nginx and Cloudflare set. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}
