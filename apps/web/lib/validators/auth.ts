import { z } from "zod";

/**
 * Request schemas for /api/v1/auth. Shared with the mobile app in due course — docs/02.
 *
 * Validation happens at the route boundary, always. A service should never be the first
 * thing to discover that `email` was a number.
 */

/** PH mobile numbers: +639XXXXXXXXX, 639XXXXXXXXX, or 09XXXXXXXXX. */
const phPhone = z
  .string()
  .trim()
  .regex(/^(\+?63|0)9\d{9}$/, "Enter a Philippine mobile number, like 09171234567.");

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

// Length is checked properly in checkPasswordStrength, which also owns the common-password
// list and the message. This bound only stops absurd payloads reaching Argon2.
const password = z.string().min(1).max(256);

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email,
  password,
  phone: phPhone,
  privacyAgreed: z.literal(true, {
    message: "You need to agree to the privacy policy to create an account.",
  }),
  marketingOptIn: z.boolean().optional(),
});

export const signInMethodsSchema = z.object({ email });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: password,
});

export const verifyEmailSchema = z.object({ token: z.string().min(1) });

export const setPasswordSchema = z.object({ password });

export type RegisterBody = z.infer<typeof registerSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
