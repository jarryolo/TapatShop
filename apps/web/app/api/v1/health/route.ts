/**
 * Uptime probe. See docs/04-api-spec.md.
 *
 * Deliberately does not touch MySQL or Redis: this endpoint answers "is the app process
 * serving requests", and an uptime check that fails on a slow query pages the wrong person.
 * A deeper readiness check can live at /api/v1/health/ready when there is something to check.
 */

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { status: 200 });
}
