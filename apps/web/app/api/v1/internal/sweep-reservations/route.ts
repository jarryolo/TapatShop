import { timingSafeEqual } from "node:crypto";

import { fail, ok } from "@/lib/api/respond";
import { reservationService } from "@/lib/services/reservation.service";

/**
 * Releases expired reservations. Meant for a cron, not a browser.
 *
 * Run it every few minutes:
 *   curl -H "x-cron-secret: $CRON_SECRET" https://tapatshop.com/api/v1/internal/sweep-reservations
 *
 * This is hygiene, not correctness — availability already ignores anything past its expiry,
 * so a sweeper that stops running leaves stale rows rather than unsellable stock.
 */
export const dynamic = "force-dynamic";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;

  // Refuse rather than run unauthenticated. An open endpoint that mutates reservations is a
  // denial-of-service vector: call it in a loop and every in-flight checkout loses its hold.
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set; refusing to sweep");
    return fail("FORBIDDEN", "Not available.");
  }

  if (!secretMatches(request.headers.get("x-cron-secret"), expected)) {
    return fail("FORBIDDEN", "Not available.");
  }

  const result = await reservationService.sweep();
  return ok({ released: result.released });
}
