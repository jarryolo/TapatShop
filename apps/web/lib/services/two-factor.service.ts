import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { Prisma, PrismaClient } from "@tapatshop/db";
import type { Role } from "@tapatshop/shared";

import { generateSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { db } from "@/lib/db";

import { log } from "./audit.service";

/**
 * Two-factor authentication for staff and admins — P5-03.
 *
 * Required for anyone who can reach the admin, not offered. A password is one leak away from
 * being someone else's, and the accounts that can change prices, read customer records and
 * move stock are the ones where that matters.
 *
 * Customers are deliberately excluded. Nothing a customer account can do is worth locking them
 * out of their own order history for, and a shop that demands an authenticator app to buy a bag
 * of coffee loses the sale instead of gaining security.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export const ISSUER = "TapatShop";

/** Who has to have it. */
export function twoFactorRequired(role: Role): boolean {
  return role === "admin" || role === "staff";
}

/**
 * Recovery codes are SHA-256, not Argon2.
 *
 * Deliberate, and the opposite of the choice for passwords. These are 80 bits of machine
 * randomness rather than something a human invented, so there is no dictionary to run and
 * nothing for a slow hash to buy — while sign-in has to check a submitted code against every
 * unused row, and ten Argon2 verifications per attempt is a denial-of-service handed over.
 */
function hashCode(code: string): string {
  return createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
}

/** Crockford-ish: no I, L, O, U, so nothing is ambiguous when read off paper. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

function makeRecoveryCode(): string {
  const bytes = randomBytes(10);
  const body = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  // Grouped, because these get written down and typed back in.
  return `${body.slice(0, 5)}-${body.slice(5)}`;
}

export interface EnrolmentStart {
  secret: string;
  uri: string;
}

/**
 * Begins enrolment: a secret and the URI to scan. Nothing is enforced yet.
 *
 * The secret is stored immediately so the code the user is about to type can be checked
 * against it, but `totpEnabledAt` stays null until they prove the app works. Enabling first
 * would lock out anyone who mis-scans the QR code.
 */
export async function startEnrolment(
  tx: Db,
  userId: string
): Promise<EnrolmentStart | { kind: "already_enabled" }> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, totpEnabledAt: true },
  });

  if (user.totpEnabledAt) return { kind: "already_enabled" };

  const secret = generateSecret();
  await tx.user.update({ where: { id: userId }, data: { totpSecret: secret } });

  return { secret, uri: otpauthUri(secret, user.email, ISSUER) };
}

export type ConfirmResult =
  { kind: "ok"; recoveryCodes: string[] } | { kind: "no_enrolment" } | { kind: "bad_code" };

/**
 * Finishes enrolment once a code from the app checks out, and issues recovery codes.
 *
 * The codes are returned in plaintext exactly once — this response is the only time they exist
 * in readable form. Storing them readably would make the table a list of bypasses for every
 * admin account at once.
 */
export async function confirmEnrolment(
  tx: Db,
  userId: string,
  code: string,
  now: Date = new Date()
): Promise<ConfirmResult> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true },
  });

  if (!user.totpSecret || user.totpEnabledAt) return { kind: "no_enrolment" };
  if (!verifyTotp(user.totpSecret, code, now.getTime())) return { kind: "bad_code" };

  const codes = Array.from({ length: 10 }, makeRecoveryCode);

  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.recoveryCode.createMany({
    data: codes.map((plain) => ({ userId, codeHash: hashCode(plain) })),
  });
  await tx.user.update({ where: { id: userId }, data: { totpEnabledAt: now } });

  await log(tx, {
    actorId: userId,
    action: "user.two_factor_enabled",
    entity: "User",
    entityId: userId,
    after: { totpEnabled: true, recoveryCodesIssued: codes.length },
  });

  return { kind: "ok", recoveryCodes: codes };
}

export type ChallengeResult =
  { kind: "ok"; usedRecoveryCode: boolean; remainingCodes: number } | { kind: "bad_code" };

/**
 * Checks a code at sign-in. Accepts either an authenticator code or one recovery code.
 *
 * A recovery code is burned on use even though it succeeded — that is the point of it being
 * single use, and someone reading a code off a screenshot must not be able to reuse it.
 */
export async function verifyChallenge(
  tx: Db,
  userId: string,
  code: string,
  now: Date = new Date()
): Promise<ChallengeResult> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true },
  });

  if (!user.totpSecret || !user.totpEnabledAt) return { kind: "bad_code" };

  if (verifyTotp(user.totpSecret, code, now.getTime())) {
    const remaining = await tx.recoveryCode.count({ where: { userId, usedAt: null } });
    return { kind: "ok", usedRecoveryCode: false, remainingCodes: remaining };
  }

  /**
   * Looked up by hash rather than compared row by row, so the query is a single indexed hit
   * whatever the code is. `usedAt: null` is part of the match, so a spent code simply is not
   * found rather than being found and then rejected.
   */
  const candidate = hashCode(code);
  const match = await tx.recoveryCode.findFirst({
    where: { userId, codeHash: candidate, usedAt: null },
    select: { id: true, codeHash: true },
  });

  if (!match) return { kind: "bad_code" };

  // Belt and braces on the indexed lookup above.
  const a = Buffer.from(match.codeHash);
  const b = Buffer.from(candidate);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { kind: "bad_code" };

  await tx.recoveryCode.update({ where: { id: match.id }, data: { usedAt: now } });
  const remaining = await tx.recoveryCode.count({ where: { userId, usedAt: null } });

  await log(tx, {
    actorId: userId,
    action: "user.recovery_code_used",
    entity: "User",
    entityId: userId,
    after: { remainingCodes: remaining },
  });

  return { kind: "ok", usedRecoveryCode: true, remainingCodes: remaining };
}

/**
 * Turns it off. Requires a current code — knowing the password is not enough.
 *
 * Otherwise a stolen password could simply remove the thing protecting against a stolen
 * password, which would make the whole feature decorative.
 */
export async function disable(
  tx: Db,
  userId: string,
  code: string,
  now: Date = new Date()
): Promise<{ kind: "ok" } | { kind: "bad_code" } | { kind: "required" }> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, totpEnabledAt: true },
  });

  // Staff and admins may re-enrol on a new phone, but they may not simply switch it off.
  if (twoFactorRequired(user.role as Role)) return { kind: "required" };
  if (!user.totpEnabledAt) return { kind: "ok" };

  const challenge = await verifyChallenge(tx, userId, code, now);
  if (challenge.kind !== "ok") return { kind: "bad_code" };

  await tx.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabledAt: null },
  });
  await tx.recoveryCode.deleteMany({ where: { userId } });

  await log(tx, {
    actorId: userId,
    action: "user.two_factor_disabled",
    entity: "User",
    entityId: userId,
    after: { totpEnabled: false },
  });

  return { kind: "ok" };
}

/** Starts again on a new phone: a fresh secret, and the old recovery codes revoked with it. */
export async function reset(tx: Db, userId: string): Promise<EnrolmentStart> {
  await tx.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabledAt: null },
  });
  await tx.recoveryCode.deleteMany({ where: { userId } });

  const started = await startEnrolment(tx, userId);
  if ("kind" in started) throw new Error("reset left an enabled enrolment behind");
  return started;
}

export async function status(tx: Db, userId: string) {
  const [user, remaining] = await Promise.all([
    tx.user.findUniqueOrThrow({
      where: { id: userId },
      // Never selects totpSecret. Nothing outside this service has any use for it.
      select: { role: true, totpEnabledAt: true },
    }),
    tx.recoveryCode.count({ where: { userId, usedAt: null } }),
  ]);

  return {
    enabled: user.totpEnabledAt !== null,
    required: twoFactorRequired(user.role as Role),
    remainingCodes: remaining,
  };
}

export const twoFactorService = {
  status: (userId: string) => status(db, userId),
  start: (userId: string) => db.$transaction((tx) => startEnrolment(tx, userId)),
  confirm: (userId: string, code: string) =>
    db.$transaction((tx) => confirmEnrolment(tx, userId, code)),
  verify: (userId: string, code: string) =>
    db.$transaction((tx) => verifyChallenge(tx, userId, code)),
  disable: (userId: string, code: string) => db.$transaction((tx) => disable(tx, userId, code)),
  reset: (userId: string) => db.$transaction((tx) => reset(tx, userId)),
};
