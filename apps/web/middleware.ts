import NextAuth from "next-auth";

import { authConfig } from "@/lib/auth.config";

/**
 * Path-prefix gating. See docs/02-architecture.md.
 *
 * Only the edge-safe config is imported — the full lib/auth.ts pulls in Prisma, which does
 * not run on the edge runtime.
 *
 * This checks the JWT and nothing else. It is a convenience that keeps customers out of the
 * admin UI; it is NOT the security boundary. Every admin route handler re-checks the role
 * server-side with requireRole().
 */
export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: [
    /**
     * Everything except static assets and the Auth.js endpoints themselves.
     *
     * The PayMongo webhook is excluded deliberately: docs/06 requires its raw body reach the
     * handler untouched for signature verification, and it authenticates by signature rather
     * than by session.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/v1/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
