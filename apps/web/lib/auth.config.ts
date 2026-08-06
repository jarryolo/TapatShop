import type { NextAuthConfig } from "next-auth";

import { canAccess } from "@/lib/admin/nav";

/**
 * The edge-safe half of the Auth.js config.
 *
 * middleware.ts runs on the edge runtime, where Prisma cannot. So the parts that only need
 * the decoded JWT live here, and everything that touches the database lives in lib/auth.ts.
 * Importing the full config into middleware is the usual way this setup breaks at build time.
 */
export const authConfig = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  providers: [],

  callbacks: {
    /**
     * Copies the token's claims onto the session.
     *
     * This lives in the edge-safe config on purpose. middleware.ts builds its `auth` object
     * through this callback, so leaving it in the Node-only config means `auth.user.role` is
     * undefined there — and `authorized` below then turns away every admin. Pure token
     * reading, no database, so it is safe on the edge.
     */
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.emailIsVerified = token.emailIsVerified;
      session.user.isMember = token.isMember;
      session.user.revocationStamp = token.revocationStamp;
      return session;
    },

    /**
     * Path gating. A convenience, not a security boundary.
     *
     * docs/02 is explicit: every admin route handler re-checks the role server-side. This
     * stops a customer wandering into /admin; it does not stop anyone who can craft a
     * request.
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const role = auth?.user?.role;

      if (pathname.startsWith("/admin") || pathname.startsWith("/api/v1/admin")) {
        if (!role) return false;
        // /api/v1/admin/orders gates on the same rules as /admin/orders.
        const navPath = pathname.replace(/^\/api\/v1/, "");
        return canAccess(role, navPath);
      }

      if (pathname.startsWith("/account")) return Boolean(auth?.user);

      return true;
    },
  },
} satisfies NextAuthConfig;
