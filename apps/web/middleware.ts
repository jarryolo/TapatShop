import NextAuth from "next-auth";
import { type NextRequest, NextResponse } from "next/server";

import { canAccess } from "@/lib/admin/nav";
import { authConfig } from "@/lib/auth.config";
import { contentSecurityPolicy, makeNonce, securityHeaders } from "@/lib/security-headers";

/**
 * Path-prefix gating, plus the security headers. See docs/02-architecture.md.
 *
 * Only the edge-safe config is imported — the full lib/auth.ts pulls in Prisma, which does
 * not run on the edge runtime.
 *
 * The auth half checks the JWT and nothing else. It is a convenience that keeps customers out
 * of the admin UI; it is NOT the security boundary. Every admin route handler re-checks the
 * role server-side with requireRole().
 */
const { auth } = NextAuth(authConfig);

/**
 * The gate, then the headers.
 *
 * **Passing a callback to `auth()` replaces the `authorized` callback in auth.config rather
 * than running after it.** Returning `NextResponse.next()` unconditionally from here therefore
 * disables the whole path gate — which is exactly what happened the first time this was
 * written, and the only reason it did not become a privilege escalation is that every admin
 * route re-checks the role server-side. The check below is that gate, moved here on purpose.
 */
export default auth(async (request) => {
  const { pathname } = request.nextUrl;
  const role = request.auth?.user?.role;

  const denied =
    pathname.startsWith("/admin") || pathname.startsWith("/api/v1/admin")
      ? // /api/v1/admin/orders gates on the same rules as /admin/orders.
        !role || !canAccess(role, pathname.replace(/^\/api\/v1/, ""))
      : pathname.startsWith("/account") && !request.auth?.user;

  const nonce = makeNonce();
  const isDev = process.env.NODE_ENV !== "production";
  const csp = contentSecurityPolicy(nonce, isDev);

  const response = denied
    ? NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(pathname)}`, request.url))
    : /**
       * The nonce travels on the *request* so Next can stamp it onto the script tags it
       * renders, and on the response so the browser knows to expect it. Both, or neither
       * works.
       */
      NextResponse.next({
        request: {
          headers: (() => {
            const headers = new Headers(request.headers);
            headers.set("x-nonce", nonce);
            headers.set("content-security-policy", csp);
            return headers;
          })(),
        },
      });

  response.headers.set("content-security-policy", csp);
  for (const [key, value] of Object.entries(securityHeaders(isDev))) {
    response.headers.set(key, value);
  }

  return response;
}) as unknown as (request: NextRequest) => Promise<Response>;

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
