import type { Role } from "@tapatshop/shared";
import { redirect } from "next/navigation";

import { auth, sessionIsCurrent } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

import { enforceRateLimit, fail } from "./respond";

/**
 * The real access check. Middleware is the convenience; this is the boundary — docs/02.
 *
 * Every admin route handler calls requireRole(). Relying on middleware alone means one
 * matcher typo silently opens the admin API, and nothing fails loudly when it happens.
 */

export interface Actor {
  id: string;
  role: Role;
  email: string;
  emailVerified: boolean;
  isMember: boolean;
}

export type GuardResult = { ok: true; actor: Actor } | { ok: false; response: Response };

async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  // A token issued before the user's last password reset is dead, even though it is still
  // cryptographically valid and unexpired. This is the only place that gets checked, so it
  // is not optional.
  const current = await sessionIsCurrent(session.user.id, session.user.revocationStamp ?? 0);
  if (!current) return null;

  return {
    id: session.user.id,
    role: session.user.role,
    email: session.user.email ?? "",
    emailVerified: session.user.emailIsVerified,
    isMember: session.user.isMember,
  };
}

/** Requires any signed-in user. */
export async function requireUser(): Promise<GuardResult> {
  const actor = await currentActor();
  if (!actor) {
    return { ok: false, response: fail("UNAUTHENTICATED", "Sign in to continue.") };
  }
  return { ok: true, actor };
}

/**
 * Requires one of the given roles.
 *
 * Returns 401 when nobody is signed in and 403 when someone is but lacks the role. Collapsing
 * both into 403 would leave a signed-out admin unable to tell they simply need to sign in.
 */
export async function requireRole(...roles: Role[]): Promise<GuardResult> {
  const actor = await currentActor();

  if (!actor) {
    return { ok: false, response: fail("UNAUTHENTICATED", "Sign in to continue.") };
  }

  if (!roles.includes(actor.role)) {
    return { ok: false, response: fail("FORBIDDEN", "You do not have access to that.") };
  }

  return { ok: true, actor };
}

/**
 * A ceiling on the admin API, keyed on the actor rather than the address.
 *
 * The role check already stops strangers. What this catches is a stolen staff session being
 * used to enumerate customers or drive a script — and the thing every one of those requests
 * shares is the account, not the IP.
 *
 * Folded into the guard rather than left as a separate call in each handler: there are twenty
 * or so admin routes and "remember to also rate limit it" is not a thing that survives the
 * twenty-first.
 */
async function withAdminLimit(
  guard: GuardResult,
  request: Request,
  write: boolean
): Promise<GuardResult> {
  if (!guard.ok) return guard;

  const limited = await enforceRateLimit(
    request,
    write ? "adminWrite" : "adminRead",
    guard.actor.id
  );

  return limited ? { ok: false, response: limited } : guard;
}

/** Anything that is not a GET changes something, so it gets the tighter ceiling. */
function isWrite(request: Request): boolean {
  return request.method !== "GET" && request.method !== "HEAD";
}

/**
 * Staff or admin. The common case for the admin API.
 *
 * `request` is required, not optional. An optional parameter here would be forgotten on some
 * future route and nothing would fail; a required one makes the compiler point at it.
 */
export async function requireStaff(request: Request): Promise<GuardResult> {
  return withAdminLimit(
    await withTwoFactor(await requireRole("staff", "admin")),
    request,
    isWrite(request)
  );
}

/** Admin only: settings, staff management, the audit log, and admin-assisted recovery. */
export async function requireAdmin(request: Request): Promise<GuardResult> {
  return withAdminLimit(await withTwoFactor(await requireRole("admin")), request, isWrite(request));
}

/**
 * Refuses a staff or admin account that has not enrolled a second factor — P5-03.
 *
 * The check is here rather than at sign-in on purpose. Enrolling needs a session and a session
 * would need an enrolment, so refusing the sign-in is circular and strands every existing
 * staff account the day this ships. Letting the session exist and shutting this door instead
 * means the only thing they can reach is the enrolment page.
 */
async function withTwoFactor(guard: GuardResult): Promise<GuardResult> {
  if (!guard.ok) return guard;

  const user = await db.user.findUnique({
    where: { id: guard.actor.id },
    select: { totpEnabledAt: true },
  });

  if (user?.totpEnabledAt) return guard;

  return {
    ok: false,
    response: fail("FORBIDDEN", "Set up two-factor authentication before using the admin.", {
      needsTwoFactor: true,
    }),
  };
}

/**
 * The role check for an admin-only **page**, which redirects rather than returning JSON.
 *
 * Pages had been relying on `canAccess` in middleware alone. docs/02 is explicit that
 * middleware is a convenience rather than the boundary, and the route handlers honour that —
 * but the pages did not, so a single mistake in the matcher or the gate rendered admin-only
 * screens to staff. One was made, and this is the second layer that should have caught it.
 *
 * No rate limit: a page render has no meaningful one, and the API behind it is limited.
 */
export async function requireAdminPage(): Promise<Actor> {
  const guard = await requireRole("admin");
  if (!guard.ok) redirect("/signin?next=/admin");
  return guard.actor;
}

/**
 * The actor shape the services want, with the request context the audit log records.
 *
 * IP and user agent are on the audit row because "who changed this price" sometimes means
 * "was that really them, or someone with their session".
 */
export function auditActor(actor: Actor, request: Request) {
  return {
    id: actor.id,
    ip: clientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
  };
}
