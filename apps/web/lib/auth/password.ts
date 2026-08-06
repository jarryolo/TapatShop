import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing. Argon2id, per docs/07-auth-and-recovery.md.
 *
 * @node-rs/argon2 ships prebuilt binaries, so there is no compiler in the install path on
 * Windows — which is what made the bcrypt fallback in docs/07 unnecessary.
 */

/**
 * OWASP's current Argon2id floor is 19 MiB and one iteration with parallelism 1. This uses
 * 19 MiB, two passes, parallelism 1. Raise these before lowering them.
 */
const OPTIONS = {
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Length beats symbols, so there are no composition rules — docs/07. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * The 20 passwords that would otherwise appear in this database within a week.
 *
 * docs/07 asks for a common-password check. A real deployment should use a proper list
 * (SecLists, or the Pwned Passwords range API); this is the floor, not the finished job.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "qwerty123",
  "iloveyou",
  "princess",
  "adminadmin",
  "letmein123",
  "welcome123",
  "monkey123",
  "sunshine1",
  "football1",
  "abc123456",
  "passw0rd",
  "trustno1",
  "starwars1",
]);

export interface PasswordProblem {
  ok: false;
  message: string;
}

export type PasswordCheck = { ok: true } | PasswordProblem;

/** Says what is wrong in words the customer can act on — docs/05 copy rules. */
export function checkPasswordStrength(password: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`,
    };
  }

  if (password.length > 256) {
    // Argon2 will happily hash megabytes. Refuse before spending the CPU on it.
    return { ok: false, message: "That password is too long. Use 256 characters or fewer." };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, message: "That password is too common. Pick something less guessable." };
  }

  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * Verifies a password. Returns false rather than throwing on a malformed stored hash, so a
 * corrupt row is a failed login rather than a 500 that reveals the row exists.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same time as a real verification.
 *
 * Login must take about as long whether or not the email exists. Without this, the response
 * time alone tells an attacker which addresses are registered — an enumeration hole that
 * survives every carefully-worded error message.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await verifyPassword(
    "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Xk8vE0X8g6JqZ3o0Qk8oQzZ4Q0h5Q0h5Q0h5Q0h5Q0g",
    "not-the-password"
  );
}
