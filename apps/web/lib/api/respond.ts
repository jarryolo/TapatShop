import type { ApiErrorCode } from "@tapatshop/shared";
import type { ZodError } from "zod";

import { LIMITS, type RateLimitRule, clientIp, rateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * The shape every /api/v1 response takes. See docs/04-api-spec.md.
 *
 * Errors are always `{ error: { code, message } }`, never a bare string, and never a Prisma
 * error or a stack trace — docs/CLAUDE.md.
 */

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  OUT_OF_STOCK: 409,
  CART_STALE: 409,
  RATE_LIMITED: 429,
  PAYMENT_FAILED: 402,
  INTERNAL: 500,
};

export function ok<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
  extraHeaders?: HeadersInit
): Response {
  return Response.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS[code], headers: extraHeaders }
  );
}

/** Turns a Zod failure into the documented 422, with per-field messages. */
export function failValidation(error: ZodError): Response {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    fieldErrors[path] ??= issue.message;
  }
  return fail("VALIDATION_ERROR", "Some of those details need fixing.", { fields: fieldErrors });
}

/** Parses JSON without letting a malformed body throw a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Applies a rate limit, returning a 429 response when the caller is over it.
 *
 * Two checks, and they do different jobs:
 *
 *   1. the scope limit, keyed on the IP and identifier *together* — this is docs/04's
 *      "per email + IP". It stops someone grinding one account from one place without
 *      punishing everyone else behind the same NAT.
 *   2. a per-IP ceiling shared across every scope, which is what actually catches one host
 *      spraying a single password across many accounts.
 *
 * Keying the scope limit on the bare IP instead would collapse both jobs into one number and
 * do neither well.
 */
export async function enforceRateLimit(
  request: Request,
  scope: Exclude<keyof typeof LIMITS, "ipCeiling">,
  identifier?: string
): Promise<Response | null> {
  const rule: RateLimitRule = LIMITS[scope];
  const ip = clientIp(request.headers);

  const checks: [string, RateLimitRule][] = [
    [rateLimitKey("ipCeiling", ip), LIMITS.ipCeiling],
    [rateLimitKey(scope, ip, identifier ?? ""), rule],
  ];

  for (const [key, limit] of checks) {
    const result = await rateLimit(key, limit);
    if (!result.allowed) {
      return fail("RATE_LIMITED", "Too many attempts. Try again shortly.", undefined, {
        "Retry-After": String(result.retryAfter),
      });
    }
  }

  return null;
}
