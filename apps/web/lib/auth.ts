import type { Role } from "@tapatshop/shared";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { authConfig } from "@/lib/auth.config";
import { db } from "@/lib/db";
import { LIMITS, type RateLimitRule, clientIp, rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { linkOAuthAccount, signInWithPassword } from "@/lib/services/auth.service";
import { verifyChallenge } from "@/lib/services/two-factor.service";

/**
 * The full Auth.js setup. Node runtime only — it touches the database.
 *
 * No Prisma adapter, on purpose. The adapter's linking behaviour is not ours: docs/07
 * requires refusing to auto-link when the existing account's email was never verified, and
 * an adapter that links on matching email would hand over an account to whoever registered
 * the address first. linkOAuthAccount owns that decision instead.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),

    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Declared, or Auth.js drops it before `authorize` ever sees it.
        totp: { label: "Authentication code", type: "text" },
      },

      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        /**
         * Rate limiting lives here, not in middleware or a route handler.
         *
         * This is Auth.js's own endpoint — /api/auth/callback/credentials — and it is
         * excluded from the middleware matcher because Auth.js has to own its callbacks. So
         * a limit applied anywhere else is trivially bypassed by posting straight to it,
         * which is exactly what a credential-stuffing script does.
         *
         * Keyed by IP and by email: by IP alone, a botnet sprays one password across every
         * account; by email alone, one host works through an address list.
         */
        const ip = clientIp(request.headers);
        const checks: [string, RateLimitRule][] = [
          [rateLimitKey("ipCeiling", ip), LIMITS.ipCeiling],
          [rateLimitKey("login", ip, email), LIMITS.login],
        ];

        for (const [key, rule] of checks) {
          const check = await rateLimit(key, rule);
          if (!check.allowed) {
            // Auth.js converts a thrown error into the same generic CredentialsSignin the
            // caller gets for a wrong password, which keeps the failure uniform.
            throw new Error("Too many sign-in attempts. Try again shortly.");
          }
        }

        const result = await signInWithPassword(db, email, password);

        // Returning null for everything except success is deliberate. The distinction
        // between "wrong password" and "this account uses Google" is surfaced by
        // POST /api/v1/auth/sign-in-methods, not by the sign-in attempt itself, so that the
        // credentials endpoint stays a single uniform failure.
        if (result.kind !== "ok") return null;

        /**
         * The second factor, checked here — after the password, never instead of it.
         *
         * Order matters. Asking for a code before the password would tell an attacker which
         * addresses have an account, and checking it after the session exists would mean a
         * session briefly existed with only one factor behind it.
         *
         * An enrolled account with no code supplied fails the same way a wrong password does.
         * The sign-in form retries with a code field once it sees that; the endpoint itself
         * stays a single uniform failure, which is the property the rest of this file protects.
         */
        if (result.user.totpEnabledAt) {
          const code = typeof credentials?.totp === "string" ? credentials.totp : "";
          if (!code) return null;

          const challenge = await verifyChallenge(db, result.user.id, code);
          if (challenge.kind !== "ok") return null;
        }

        /**
         * A staff or admin who has not enrolled yet still gets a session — and then gets no
         * further. `requireStaff`/`requireAdmin` refuse them and the admin shell sends them to
         * /account/two-factor.
         *
         * Refusing the sign-in outright instead would be circular: enrolling needs a session,
         * and a session would need an enrolment. This way the door is shut without the key
         * being locked inside the room.
         */

        await db.user.update({
          where: { id: result.user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
          emailIsVerified: Boolean(result.user.emailVerifiedAt),
          isMember: Boolean(result.user.memberVerifiedAt),
        };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /** Applies the docs/07 linking rules before any OAuth sign-in is allowed through. */
    async signIn({ account, profile, user }) {
      if (!account || account.provider === "credentials") return true;

      const email = profile?.email ?? user.email;
      if (!email) return false;

      const result = await linkOAuthAccount(db, {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email,
        name: profile?.name ?? user.name ?? "",
        // Google sets email_verified. Absent it, treat the address as unproven.
        emailVerified: profile?.email_verified === true,
      });

      if (result.kind === "verification-required") {
        // An unverified local account with this address already exists. Linking now would
        // hand it to whoever registered the address first.
        return "/signin?error=verify-email-first";
      }

      user.id = result.userId;
      return true;
    },

    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.id = user.id;
      }

      // Refresh role and status from the database on sign-in and on an explicit update, so a
      // member verified by an admin does not have to sign out and back in to see it.
      if (user || trigger === "update" || !token.role) {
        if (!token.id) return null;

        const record = await db.user.findUnique({
          where: { id: token.id },
          select: {
            role: true,
            emailVerifiedAt: true,
            memberVerifiedAt: true,
            disabledAt: true,
            sessionsRevokedAt: true,
          },
        });

        if (!record || record.disabledAt) return null;

        token.role = record.role as Role;
        token.emailIsVerified = Boolean(record.emailVerifiedAt);
        token.isMember = Boolean(record.memberVerifiedAt);
        token.revocationStamp = record.sessionsRevokedAt?.getTime() ?? 0;
      }

      return token;
    },

    // `session` is deliberately not overridden here — it lives in auth.config.ts so that
    // middleware, which only loads the edge-safe config, sees the same session shape.
  },

  events: {
    async signOut() {
      // Placeholder for audit logging once P4-06 lands.
    },
  },
});

/**
 * Rejects a session issued before the user's sessions were revoked.
 *
 * JWTs cannot be deleted server-side, so a password reset stamps `sessionsRevokedAt` on the
 * user and the token carries the value it saw at issue time. If the stored stamp has since
 * moved past the token's copy, this token predates the revocation and is dead. That is what
 * makes "revoke all sessions on password reset" in docs/07 true rather than aspirational.
 *
 * Costs one primary-key lookup, so it runs in the route guards rather than in the jwt
 * callback on every request. The gap that leaves is narrow and deliberate: a revoked session
 * can still read public pages until it touches a guarded route.
 */
export async function sessionIsCurrent(userId: string, revocationStamp: number): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { sessionsRevokedAt: true, disabledAt: true },
  });

  if (!user || user.disabledAt) return false;
  if (!user.sessionsRevokedAt) return true;

  return user.sessionsRevokedAt.getTime() <= revocationStamp;
}
