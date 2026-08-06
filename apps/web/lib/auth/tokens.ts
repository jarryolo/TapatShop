import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-time tokens for email verification and password reset.
 *
 * Only the hash is stored — docs/07. A database leak then yields nothing usable: the
 * attacker has hashes, and the reset link needs the preimage. Storing the raw token would
 * turn a read-only leak into account takeover for every pending reset.
 */

/** 32 bytes of CSPRNG output, base64url. Not guessable, and URL-safe without escaping. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison of two token hashes.
 *
 * SHA-256 is fine for tokens — unlike passwords they are already high-entropy, so there is
 * nothing to brute force. The constant-time compare is about not leaking a prefix match
 * through timing.
 */
export function tokensMatch(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Password reset links expire in 30 minutes — docs/07. */
export const RESET_TOKEN_TTL_MINUTES = 30;

/** Email verification is less time-critical and links get opened late. */
export const VERIFY_TOKEN_TTL_HOURS = 24;

export function resetTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);
}

export function verifyTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + VERIFY_TOKEN_TTL_HOURS * 3_600_000);
}

/** A six-digit numeric OTP for phone recovery — docs/07. Uniform, not `random % 1000000`. */
export function generateOtp(): string {
  // Rejection sampling: 4294967295 is not a multiple of 1000000, so plain modulo would make
  // the lowest codes fractionally more likely.
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);

  return (value % 1_000_000).toString().padStart(6, "0");
}
