/**
 * Transactional email.
 *
 * STUB. Resend integration is P3-06. Until then this logs so the auth flows can be walked
 * end to end locally — a verification link printed to the terminal is enough to click.
 *
 * The interface is the point: callers should not change when the transport does.
 */

export type EmailTemplate =
  | "verify-email"
  | "password-reset"
  | "password-changed"
  | "provider-linked"
  | "sign-in-method-reminder"
  | "email-changed"
  // Carries the confirmation link for an admin-approved recovery. Never a password.
  | "account-recovery-approved"
  | "order-confirmation"
  | "order-shipped"
  | "order-delivered"
  | "order-refunded";

export interface EmailMessage {
  to: string;
  template: EmailTemplate;
  /** Values the template needs. Never put a raw password or a token hash in here. */
  data: Record<string, string>;
}

/**
 * Queues a message. Never throws.
 *
 * A failed email must not fail the request that triggered it — a customer whose password
 * reset succeeded but whose notification bounced should still have a working password.
 * P3-06 replaces this with a real queue and a retry.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  await Promise.resolve();

  if (process.env.NODE_ENV === "production") {
    // Deliberately not implemented. Shipping to production with a no-op mailer would mean
    // silently dropping password resets, so this is loud.
    console.error(
      `[email] NOT SENT — no transport configured. template=${message.template} to=${message.to}`
    );
    return;
  }

  console.warn(`[email] ${message.template} -> ${message.to}`, message.data);
}
