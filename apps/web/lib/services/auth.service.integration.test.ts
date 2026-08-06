import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { generateToken, hashToken, resetTokenExpiry, verifyTokenExpiry } from "@/lib/auth/tokens";

import {
  linkOAuthAccount,
  register,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  unlinkProvider,
  verifyEmail,
} from "./auth.service";

/**
 * The docs/07 rules, against a real database.
 *
 * These are the P1-05 acceptance criteria, and every one of them is a rule that is easy to
 * get subtly wrong in a way unit tests with mocks would happily confirm. They run against
 * `tapatshop_test`, never the development database.
 *
 * Skipped when TEST_DATABASE_URL is unset so the unit suite still runs without MySQL.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

/** Unique per test so a leftover row cannot make a later run pass or fail by accident. */
let counter = 0;
function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}-${counter}-${process.pid}@example.test`;
}

describeIntegration("auth.service", () => {
  beforeEach(async () => {
    // Children first.
    await db.passwordResetToken.deleteMany();
    await db.account.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => {
    await db.passwordResetToken.deleteMany();
    await db.account.deleteMany();
    await db.user.deleteMany();
    await db.$disconnect();
  });

  describe("registration", () => {
    it("creates a user and a verification token", async () => {
      const email = uniqueEmail("register");
      const result = await register(db, {
        name: "Joel Santos",
        email,
        password: "correct horse battery staple",
        phone: "09171234567",
        privacyAgreed: true,
      });

      expect(result.kind).toBe("ok");

      const user = await db.user.findUnique({ where: { email } });
      expect(user?.emailVerifiedAt).toBeNull();
      expect(user?.privacyAgreedAt).toBeInstanceOf(Date);
      expect(await db.passwordResetToken.count({ where: { userId: user?.id } })).toBe(1);
    });

    it("never stores the password in a readable form", async () => {
      const email = uniqueEmail("hashing");
      await register(db, {
        name: "Joel Santos",
        email,
        password: "correct horse battery staple",
        phone: "09171234567",
        privacyAgreed: true,
      });

      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(user.passwordHash).not.toContain("correct horse");
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it("refuses without privacy consent, per the Data Privacy Act", async () => {
      const result = await register(db, {
        name: "Joel Santos",
        email: uniqueEmail("no-consent"),
        password: "correct horse battery staple",
        phone: "09171234567",
        privacyAgreed: false,
      });

      expect(result.kind).toBe("privacy-not-agreed");
    });

    it("normalises the email, so one address cannot register twice", async () => {
      const email = uniqueEmail("Mixed-Case");
      const base = {
        name: "Joel Santos",
        password: "correct horse battery staple",
        phone: "09171234567",
        privacyAgreed: true as const,
      };

      expect((await register(db, { ...base, email: email.toUpperCase() })).kind).toBe("ok");
      expect((await register(db, { ...base, email: email.toLowerCase() })).kind).toBe(
        "email-taken"
      );
    });
  });

  describe("password sign-in", () => {
    async function makePasswordUser(email: string) {
      return db.user.create({
        data: {
          name: "Joel Santos",
          email,
          passwordHash: await hashPassword("correct horse battery staple"),
          emailVerifiedAt: new Date(),
        },
      });
    }

    it("accepts the right password", async () => {
      const email = uniqueEmail("signin");
      await makePasswordUser(email);

      const result = await signInWithPassword(db, email, "correct horse battery staple");
      expect(result.kind).toBe("ok");
    });

    it("rejects the wrong password", async () => {
      const email = uniqueEmail("signin-wrong");
      await makePasswordUser(email);

      expect((await signInWithPassword(db, email, "wrong")).kind).toBe("invalid");
    });

    it("gives an unknown address the same answer as a wrong password", async () => {
      const result = await signInWithPassword(db, uniqueEmail("nobody"), "whatever");
      expect(result.kind).toBe("invalid");
    });

    it("tells a Google-only account to use Google, not 'wrong password'", async () => {
      // The first acceptance criterion of P1-05. A Google user who forgot how they signed up
      // is otherwise stuck in a loop no amount of retrying escapes.
      const email = uniqueEmail("google-only");
      await db.user.create({
        data: {
          name: "Joel Santos",
          email,
          emailVerifiedAt: new Date(),
          accounts: { create: { provider: "google", providerAccountId: "g-1", type: "oauth" } },
        },
      });

      const result = await signInWithPassword(db, email, "anything at all");
      expect(result.kind).toBe("use-provider");
      if (result.kind === "use-provider") expect(result.providers).toEqual(["google"]);
    });

    it("refuses a disabled account even with the right password", async () => {
      const email = uniqueEmail("disabled");
      const user = await makePasswordUser(email);
      await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });

      expect((await signInWithPassword(db, email, "correct horse battery staple")).kind).toBe(
        "disabled"
      );
    });
  });

  describe("OAuth linking", () => {
    const google = (email: string, verified = true) => ({
      provider: "google",
      providerAccountId: `google-${email}`,
      email,
      name: "Joel Santos",
      emailVerified: verified,
    });

    it("creates an account when the email is new", async () => {
      const email = uniqueEmail("oauth-new");
      const result = await linkOAuthAccount(db, google(email));

      expect(result.kind).toBe("created");
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.passwordHash).toBeNull();
    });

    it("auto-links when the existing email is verified", async () => {
      const email = uniqueEmail("oauth-verified");
      await db.user.create({
        data: {
          name: "Joel Santos",
          email,
          passwordHash: await hashPassword("correct horse battery staple"),
          emailVerifiedAt: new Date(),
        },
      });

      const result = await linkOAuthAccount(db, google(email));
      expect(result.kind).toBe("linked");
      expect(await db.account.count({ where: { user: { email } } })).toBe(1);
    });

    it("REFUSES to link when the existing email was never verified", async () => {
      // The attack this prevents: register an unverified account with someone else's
      // address, wait for them to sign in with Google, and inherit their account.
      const email = uniqueEmail("oauth-unverified");
      await db.user.create({
        data: {
          name: "Impostor",
          email,
          passwordHash: await hashPassword("correct horse battery staple"),
          emailVerifiedAt: null,
        },
      });

      const result = await linkOAuthAccount(db, google(email));
      expect(result.kind).toBe("verification-required");
      expect(await db.account.count({ where: { user: { email } } })).toBe(0);
    });

    it("refuses to link when the provider itself does not vouch for the address", async () => {
      const email = uniqueEmail("oauth-unproven");
      await db.user.create({ data: { name: "Joel", email, emailVerifiedAt: new Date() } });

      const result = await linkOAuthAccount(db, google(email, false));
      expect(result.kind).toBe("verification-required");
    });

    it("signs straight in on a second visit, without duplicating the link", async () => {
      const email = uniqueEmail("oauth-repeat");
      await linkOAuthAccount(db, google(email));

      const result = await linkOAuthAccount(db, google(email));
      expect(result.kind).toBe("signed-in");
      expect(await db.account.count({ where: { user: { email } } })).toBe(1);
    });
  });

  describe("password reset", () => {
    async function userWithResetToken(email: string) {
      const user = await db.user.create({
        data: {
          name: "Joel Santos",
          email,
          passwordHash: await hashPassword("correct horse battery staple"),
          emailVerifiedAt: new Date(),
        },
      });
      const token = generateToken();
      await db.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: resetTokenExpiry() },
      });
      return { user, token };
    }

    it("stores only the hash, never the token", async () => {
      const { token } = await userWithResetToken(uniqueEmail("reset-hash"));
      const stored = await db.passwordResetToken.findFirstOrThrow();

      expect(stored.tokenHash).not.toBe(token);
      expect(stored.tokenHash).toBe(hashToken(token));
    });

    it("changes the password and burns the token", async () => {
      const email = uniqueEmail("reset-ok");
      const { token } = await userWithResetToken(email);

      expect((await resetPassword(db, token, "a whole new passphrase")).kind).toBe("ok");
      expect((await signInWithPassword(db, email, "a whole new passphrase")).kind).toBe("ok");

      const stored = await db.passwordResetToken.findFirstOrThrow();
      expect(stored.usedAt).not.toBeNull();
    });

    it("is single use", async () => {
      const { token } = await userWithResetToken(uniqueEmail("reset-once"));

      expect((await resetPassword(db, token, "a whole new passphrase")).kind).toBe("ok");
      expect((await resetPassword(db, token, "another passphrase entirely")).kind).toBe(
        "invalid-token"
      );
    });

    it("invalidates every other outstanding token for that user", async () => {
      const email = uniqueEmail("reset-siblings");
      const { user, token } = await userWithResetToken(email);

      const second = generateToken();
      await db.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(second), expiresAt: resetTokenExpiry() },
      });

      await resetPassword(db, token, "a whole new passphrase");

      // A second reset link mailed earlier must not still work afterwards.
      expect((await resetPassword(db, second, "yet another passphrase")).kind).toBe(
        "invalid-token"
      );
    });

    it("rejects an expired token", async () => {
      const email = uniqueEmail("reset-expired");
      const user = await db.user.create({
        data: { name: "Joel", email, passwordHash: await hashPassword("correct horse staple") },
      });
      const token = generateToken();
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      expect((await resetPassword(db, token, "a whole new passphrase")).kind).toBe("invalid-token");
    });

    it("revokes existing sessions", async () => {
      const email = uniqueEmail("reset-revoke");
      const { user, token } = await userWithResetToken(email);
      expect(user.sessionsRevokedAt).toBeNull();

      await resetPassword(db, token, "a whole new passphrase");

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.sessionsRevokedAt).toBeInstanceOf(Date);
    });

    it("rejects a weak new password", async () => {
      const { token } = await userWithResetToken(uniqueEmail("reset-weak"));
      expect((await resetPassword(db, token, "short")).kind).toBe("weak-password");
    });

    it("creates no token for an address that does not exist", async () => {
      await requestPasswordReset(db, uniqueEmail("ghost"));
      expect(await db.passwordResetToken.count()).toBe(0);
    });

    it("creates no token for a Google-only account", async () => {
      const email = uniqueEmail("reset-google");
      await db.user.create({
        data: {
          name: "Joel",
          email,
          emailVerifiedAt: new Date(),
          accounts: { create: { provider: "google", providerAccountId: "g-2", type: "oauth" } },
        },
      });

      await requestPasswordReset(db, email);
      expect(await db.passwordResetToken.count()).toBe(0);
    });
  });

  describe("email verification", () => {
    async function userWithVerifyToken(email: string) {
      const user = await db.user.create({ data: { name: "Joel Santos", email } });
      const token = generateToken();
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          purpose: "email_verification",
          expiresAt: verifyTokenExpiry(),
        },
      });
      return { user, token };
    }

    it("marks the address verified and burns the token", async () => {
      const { user, token } = await userWithVerifyToken(uniqueEmail("verify-ok"));

      expect(await verifyEmail(db, token)).toBe(true);

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.emailVerifiedAt).toBeInstanceOf(Date);

      const stored = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(stored.usedAt).not.toBeNull();
    });

    it("is single use", async () => {
      const { token } = await userWithVerifyToken(uniqueEmail("verify-once"));

      expect(await verifyEmail(db, token)).toBe(true);
      expect(await verifyEmail(db, token)).toBe(false);
    });

    it("rejects a token that was never issued", async () => {
      expect(await verifyEmail(db, "clearly-not-the-token")).toBe(false);
    });

    it("registration issues a verification token, not a reset token", async () => {
      const email = uniqueEmail("verify-purpose");
      await register(db, {
        name: "Joel Santos",
        email,
        password: "correct horse battery staple",
        phone: "09171234567",
        privacyAgreed: true,
      });

      const stored = await db.passwordResetToken.findFirstOrThrow();
      expect(stored.purpose).toBe("email_verification");
    });
  });

  describe("token purposes do not cross over", () => {
    // A verification link lives 24 hours and ends up forwarded and logged. A reset link
    // lives 30 minutes. Letting one act as the other turns a low-value token into account
    // takeover, so each is pinned to its purpose.
    it("refuses to reset a password with an email verification token", async () => {
      const email = uniqueEmail("cross-verify");
      const user = await db.user.create({
        data: {
          name: "Joel",
          email,
          passwordHash: await hashPassword("correct horse battery staple"),
        },
      });
      const token = generateToken();
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          purpose: "email_verification",
          expiresAt: verifyTokenExpiry(),
        },
      });

      expect((await resetPassword(db, token, "a whole new passphrase")).kind).toBe("invalid-token");
      // And the original password still works.
      expect((await signInWithPassword(db, email, "correct horse battery staple")).kind).toBe("ok");
    });

    it("refuses to verify an email with a password reset token", async () => {
      const email = uniqueEmail("cross-reset");
      const user = await db.user.create({
        data: {
          name: "Joel",
          email,
          passwordHash: await hashPassword("correct horse battery staple"),
        },
      });
      const token = generateToken();
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          purpose: "password_reset",
          expiresAt: resetTokenExpiry(),
        },
      });

      expect(await verifyEmail(db, token)).toBe(false);

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.emailVerifiedAt).toBeNull();
    });
  });

  describe("unlinking", () => {
    it("refuses to remove the only way in", async () => {
      const email = uniqueEmail("unlink-only");
      const user = await db.user.create({
        data: {
          name: "Joel",
          email,
          emailVerifiedAt: new Date(),
          accounts: { create: { provider: "google", providerAccountId: "g-3", type: "oauth" } },
        },
      });

      expect((await unlinkProvider(db, user.id, "google")).kind).toBe("would-lock-out");
      expect(await db.account.count({ where: { userId: user.id } })).toBe(1);
    });

    it("allows removal once a password exists", async () => {
      const email = uniqueEmail("unlink-ok");
      const user = await db.user.create({
        data: {
          name: "Joel",
          email,
          passwordHash: await hashPassword("correct horse battery staple"),
          emailVerifiedAt: new Date(),
          accounts: { create: { provider: "google", providerAccountId: "g-4", type: "oauth" } },
        },
      });

      expect((await unlinkProvider(db, user.id, "google")).kind).toBe("ok");
      expect(await db.account.count({ where: { userId: user.id } })).toBe(0);
    });
  });
});
