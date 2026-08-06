import type { Prisma, PrismaClient, User } from "@tapatshop/db";

import {
  checkPasswordStrength,
  fakeVerifyDelay,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  generateToken,
  hashToken,
  resetTokenExpiry,
  tokensMatch,
  verifyTokenExpiry,
} from "@/lib/auth/tokens";
import { db } from "@/lib/db";

import { sendEmail } from "./email.service";

/**
 * Authentication, account linking, and recovery. Rules are in docs/07-auth-and-recovery.md.
 *
 * Services take an optional transaction client first so they compose — docs/02.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** Emails are stored and compared lowercased. Otherwise one address can register twice. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─────────────────────────────  sign-in methods  ─────────────────────────────

export interface SignInMethods {
  hasPassword: boolean;
  providers: string[];
}

export async function signInMethodsFor(tx: Db, userId: string): Promise<SignInMethods> {
  const [user, accounts] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
    tx.account.findMany({ where: { userId }, select: { provider: true } }),
  ]);

  return {
    hasPassword: Boolean(user?.passwordHash),
    providers: accounts.map((a) => a.provider),
  };
}

// ─────────────────────────────  password sign-in  ─────────────────────────────

export type PasswordSignInResult =
  | { kind: "ok"; user: User }
  | { kind: "invalid" }
  | { kind: "disabled" }
  /**
   * The account exists but has no password — it signs in with Google.
   *
   * docs/07 requires telling the customer this rather than "wrong password", because
   * otherwise a Google user who forgot how they signed up is stuck in a loop they cannot
   * reason their way out of.
   *
   * This does confirm the address is registered, which is an enumeration disclosure the
   * "invalid" path is careful to avoid. That trade is the spec's deliberate choice, not an
   * oversight. It is also why this path is rate limited exactly like a failed password.
   */
  | { kind: "use-provider"; providers: string[] };

export async function signInWithPassword(
  tx: Db,
  emailInput: string,
  password: string
): Promise<PasswordSignInResult> {
  const email = normaliseEmail(emailInput);
  const user = await tx.user.findUnique({ where: { email } });

  if (!user) {
    // Spend the same time as a real verification so response timing does not reveal that
    // this address is unregistered.
    await fakeVerifyDelay();
    return { kind: "invalid" };
  }

  if (user.disabledAt) return { kind: "disabled" };

  if (!user.passwordHash) {
    const accounts = await tx.account.findMany({
      where: { userId: user.id },
      select: { provider: true },
    });
    if (accounts.length > 0) {
      return { kind: "use-provider", providers: accounts.map((a) => a.provider) };
    }
    await fakeVerifyDelay();
    return { kind: "invalid" };
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return { kind: "invalid" };

  return { kind: "ok", user };
}

// ─────────────────────────────  registration  ─────────────────────────────

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone: string;
  privacyAgreed: boolean;
  marketingOptIn?: boolean;
}

export type RegisterResult =
  | { kind: "ok"; userId: string }
  | { kind: "weak-password"; message: string }
  | { kind: "privacy-not-agreed" }
  /** Already registered. The route deliberately does not surface this — see below. */
  | { kind: "email-taken" };

/**
 * Creates a credentials account and sends a verification email.
 *
 * Email verification is required before reviewing or receiving member pricing, but NOT
 * before checkout — docs/07 is explicit that blocking checkout on it costs sales for no
 * security benefit.
 */
export async function register(tx: Db, input: RegisterInput): Promise<RegisterResult> {
  if (!input.privacyAgreed) return { kind: "privacy-not-agreed" };

  const strength = checkPasswordStrength(input.password);
  if (!strength.ok) return { kind: "weak-password", message: strength.message };

  const email = normaliseEmail(input.email);
  const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { kind: "email-taken" };

  const passwordHash = await hashPassword(input.password);
  const token = generateToken();

  const user = await tx.user.create({
    data: {
      name: input.name.trim(),
      email,
      phone: input.phone.trim(),
      passwordHash,
      privacyAgreedAt: new Date(),
      marketingOptIn: input.marketingOptIn ?? false,
      resetTokens: {
        create: {
          tokenHash: hashToken(token),
          purpose: "email_verification",
          expiresAt: verifyTokenExpiry(),
        },
      },
    },
  });

  await sendEmail({
    to: email,
    template: "verify-email",
    data: { name: user.name, token },
  });

  return { kind: "ok", userId: user.id };
}

// ─────────────────────────────  email verification  ─────────────────────────────

export async function verifyEmail(tx: Db, token: string): Promise<boolean> {
  const record = await tx.passwordResetToken.findFirst({
    where: {
      tokenHash: hashToken(token),
      // Scoped to its purpose: a password reset token must not double as a way to mark an
      // address verified, and vice versa.
      purpose: "email_verification",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!record || !tokensMatch(hashToken(token), record.tokenHash)) return false;

  await tx.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  await tx.user.update({
    where: { id: record.userId },
    data: { emailVerifiedAt: new Date() },
  });

  return true;
}

// ─────────────────────────────  OAuth linking  ─────────────────────────────

export type OAuthLinkResult =
  | { kind: "signed-in"; userId: string }
  | { kind: "created"; userId: string }
  | { kind: "linked"; userId: string }
  /**
   * An account with this email exists but its address was never verified, so linking is
   * refused. Without this check, registering an unverified account with someone else's
   * address and waiting for them to sign in with Google hands over their account.
   */
  | { kind: "verification-required" };

export interface OAuthProfile {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  /** Whether the provider asserts the address is verified. Google sets this. */
  emailVerified: boolean;
}

export async function linkOAuthAccount(tx: Db, profile: OAuthProfile): Promise<OAuthLinkResult> {
  const email = normaliseEmail(profile.email);

  // Already linked: straight in.
  const linked = await tx.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    select: { userId: true },
  });
  if (linked) return { kind: "signed-in", userId: linked.userId };

  const existing = await tx.user.findUnique({ where: { email } });

  if (!existing) {
    const user = await tx.user.create({
      data: {
        name: profile.name.trim() || email,
        email,
        // The provider has already proven control of the address, so this account starts
        // verified. It has no password, which is what makes it "Google-only".
        emailVerifiedAt: profile.emailVerified ? new Date() : null,
        privacyAgreedAt: new Date(),
        accounts: {
          create: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
            type: "oauth",
          },
        },
      },
    });
    return { kind: "created", userId: user.id };
  }

  // The rule that matters. Auto-link only when BOTH sides have proven the address:
  // the provider asserts it, and our own record was already verified.
  if (!existing.emailVerifiedAt || !profile.emailVerified) {
    return { kind: "verification-required" };
  }

  await tx.account.create({
    data: {
      userId: existing.id,
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
      type: "oauth",
    },
  });

  // Tell the address that something was attached to it. If this was not them, this notice
  // is how they find out — docs/07.
  await sendEmail({
    to: existing.email,
    template: "provider-linked",
    data: { name: existing.name, provider: profile.provider },
  });

  return { kind: "linked", userId: existing.id };
}

// ─────────────────────────────  password reset  ─────────────────────────────

/**
 * Starts a reset. Always resolves the same way.
 *
 * The caller must return an identical response no matter what happened in here — preventing
 * account enumeration is the entire point of the endpoint's design, per docs/07.
 */
export async function requestPasswordReset(tx: Db, emailInput: string): Promise<void> {
  const email = normaliseEmail(emailInput);
  const user = await tx.user.findUnique({ where: { email } });

  if (!user || user.disabledAt) return;

  if (!user.passwordHash) {
    // A Google-only account has no password to reset. Silently doing nothing would leave the
    // customer waiting for an email that never arrives, so send one explaining how they
    // actually sign in. Still no different response to the caller.
    await sendEmail({
      to: email,
      template: "sign-in-method-reminder",
      data: { name: user.name },
    });
    return;
  }

  const token = generateToken();
  await tx.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      purpose: "password_reset",
      expiresAt: resetTokenExpiry(),
    },
  });

  await sendEmail({ to: email, template: "password-reset", data: { name: user.name, token } });
}

export type ResetPasswordResult =
  { kind: "ok" } | { kind: "invalid-token" } | { kind: "weak-password"; message: string };

/**
 * Completes a reset.
 *
 * On success: the token is burned, every other outstanding token for that user is burned
 * too, and all existing sessions are revoked. A password reset is the one moment when an
 * attacker holding a stolen session must be kicked out — docs/07.
 */
export async function resetPassword(
  tx: Db,
  token: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) return { kind: "weak-password", message: strength.message };

  const candidateHash = hashToken(token);
  const record = await tx.passwordResetToken.findFirst({
    where: {
      tokenHash: candidateHash,
      // An email verification link must not be redeemable here. It lives for 24 hours and
      // ends up in forwarded mail and log files; a reset link lives for 30 minutes.
      purpose: "password_reset",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!record || !tokensMatch(candidateHash, record.tokenHash)) return { kind: "invalid-token" };

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } });
  // Only sibling reset tokens. Burning the pending verification token too would leave a new
  // customer unable to verify their address after resetting a forgotten password.
  await tx.passwordResetToken.updateMany({
    where: { userId: record.userId, purpose: "password_reset", usedAt: null },
    data: { usedAt: now },
  });
  await tx.user.update({
    where: { id: record.userId },
    data: { passwordHash, sessionsRevokedAt: now },
  });

  await sendEmail({
    to: record.user.email,
    template: "password-changed",
    data: { name: record.user.name },
  });

  return { kind: "ok" };
}

// ─────────────────────────────  set password on an OAuth account  ─────────────────────────────

export type SetPasswordResult =
  { kind: "ok" } | { kind: "weak-password"; message: string } | { kind: "already-has-password" };

/**
 * Adds a password to an account that only had a provider.
 *
 * docs/07 calls this a credential change, not a profile edit: the caller must have a live
 * session AND a recent sign-in. Enforcing that is the route's job, since only it knows when
 * the session was issued.
 */
export async function setPassword(
  tx: Db,
  userId: string,
  password: string
): Promise<SetPasswordResult> {
  const strength = checkPasswordStrength(password);
  if (!strength.ok) return { kind: "weak-password", message: strength.message };

  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.passwordHash) return { kind: "already-has-password" };

  await tx.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });

  await sendEmail({ to: user.email, template: "password-changed", data: { name: user.name } });
  return { kind: "ok" };
}

// ─────────────────────────────  unlinking  ─────────────────────────────

export type UnlinkResult = { kind: "ok" } | { kind: "would-lock-out" } | { kind: "not-linked" };

/**
 * Removes a provider, unless it is the last way in.
 *
 * Every account must keep at least one working sign-in method — docs/07. Without this check
 * a customer can lock themselves out with two clicks and no way back except admin-assisted
 * recovery.
 */
export async function unlinkProvider(
  tx: Db,
  userId: string,
  provider: string
): Promise<UnlinkResult> {
  const methods = await signInMethodsFor(tx, userId);
  if (!methods.providers.includes(provider)) return { kind: "not-linked" };

  const remaining = methods.providers.filter((p) => p !== provider).length;
  if (remaining === 0 && !methods.hasPassword) return { kind: "would-lock-out" };

  await tx.account.deleteMany({ where: { userId, provider } });
  return { kind: "ok" };
}

/** Bound to the concrete client for callers that do not need a transaction. */
export const authService = {
  signInWithPassword: (email: string, password: string) => signInWithPassword(db, email, password),
  register: (input: RegisterInput) => register(db, input),
  verifyEmail: (token: string) => verifyEmail(db, token),
  linkOAuthAccount: (profile: OAuthProfile) => linkOAuthAccount(db, profile),
  requestPasswordReset: (email: string) => requestPasswordReset(db, email),
  resetPassword: (token: string, password: string) => resetPassword(db, token, password),
  setPassword: (userId: string, password: string) => setPassword(db, userId, password),
  unlinkProvider: (userId: string, provider: string) => unlinkProvider(db, userId, provider),
  signInMethodsFor: (userId: string) => signInMethodsFor(db, userId),
};
