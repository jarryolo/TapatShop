import type { Role } from "@tapatshop/shared";

import { auth, sessionIsCurrent } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";

import { fail } from "./respond";

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

/** Staff or admin. The common case for the admin API. */
export function requireStaff(): Promise<GuardResult> {
  return requireRole("staff", "admin");
}

/** Admin only: settings, staff management, the audit log, and admin-assisted recovery. */
export function requireAdmin(): Promise<GuardResult> {
  return requireRole("admin");
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
