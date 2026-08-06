# 07 — Auth, account linking, and recovery

Auth.js (NextAuth v5) with two providers: `credentials` (email + password) and `google`.
JWT sessions so the mobile app can use the same tokens.

## Password rules

Argon2id, or bcrypt cost 12 if Argon2 is impractical. Minimum 10 characters, checked
against a common-password list. No composition rules — length beats symbols. No forced
rotation.

## Account linking

A user may have a password, a Google link, or both. `Account` holds one row per provider
with a unique constraint on `(provider, providerAccountId)`.

| Situation | Required behavior |
|---|---|
| Google account exists; user submits email + password | Do **not** say "wrong password". Say the account uses Google sign-in and show the Google button. |
| Password account exists; user signs in with Google on the same **verified** email | Auto-link, sign them in, and email a notice to that address that Google was linked. |
| Same email, but the existing account's email was never verified | Do **not** auto-link. Require email verification first. Otherwise an attacker who registers an unverified account with someone else's address can capture it. |
| Google-only user visits account settings | Offer "Set a password". Prompt for this once after their first successful order. |
| User tries to unlink their only sign-in method | Refuse with a clear message. Every account must retain at least one working method. |

Setting a password on a Google-only account requires either an active session **and** a
recent sign-in, or email confirmation. Treat it as a credential change, not a profile edit.

## Forgot password (credentials accounts)

1. `POST /auth/forgot-password` — always returns the same 200 message regardless of whether
   the email exists. Account enumeration is the thing being prevented here.
2. Store only a hash of the token. 30-minute expiry, single use, invalidated when used.
3. On successful reset: invalidate all other reset tokens, revoke existing sessions, and
   email the user that their password changed.
4. Rate limit to 3 requests per hour per email.

## When the Gmail account itself is lost

This is the case with no email path. Rank the recovery routes; the goal is that route 3 is
almost never needed.

**Route 1 — phone OTP (primary).** Collect and verify a mobile number at registration. In
the Philippines this is more reliable than email. Six-digit code, five-minute expiry, max
three attempts, then a fifteen-minute lockout. Store only the hash. Rate limit to three
requests per hour per phone number.

**Route 2 — recovery email.** Optional second address in account settings. Weaker than
phone, but cheap to support and useful for people without a stable number.

**Route 3 — admin-assisted recovery.** A last resort with a deliberate paper trail.

1. User submits a request through a public form: name, member number, and the order number
   plus delivery address of a recent order.
2. An admin opens the request in `/admin/customers/:id/recovery` and verifies against the
   order history. Two matching data points minimum.
3. Admin triggers a change-of-login-email flow. This sends a confirmation link to the
   **new** address; the admin never sets a password and never sees one.
4. The old address and the verified phone both receive a notice that the login email was
   changed.
5. Every step writes an `AuditLog` row.

Admins must never be able to read, set, or bypass a password, and must never be able to
sign in as a customer. If impersonation is ever needed for support, build it as an explicit
audited "view as" that is read-only.

## Guest order lookup

Any locked-out person should still be able to track their shipment: `GET /orders/track`
with order number plus the email on the order, rate limited to five per minute per IP.
This absorbs most of the support volume that would otherwise become recovery requests.

## Change notifications

Any change to email, password, phone, or a linked provider sends an alert to the
**previous** address as well as the new one. This is the detection mechanism if an account
was compromised rather than simply lost. Include the time and a "this wasn't me" link.

## Session handling

- JWT, 30-day expiry, sliding refresh
- Revoke all sessions on password reset and on email change
- httpOnly, secure, `sameSite=lax` cookies on web; secure storage on mobile
- Track `lastLoginAt` for the admin customer view

## Registration

Required: name, email, password, phone, and an explicit Data Privacy Act consent checkbox
(unticked by default, linked to the privacy policy). Marketing opt-in is a separate,
optional checkbox — never bundle the two.

Email verification is required before an account can leave a review or receive member
pricing, but **not** before checking out. Blocking checkout on email verification will cost
sales for no security benefit.

## Admin accounts

- Created only by an existing admin, never self-registered
- Require a password plus TOTP two-factor before production launch
- Admin sessions expire after 12 hours regardless of activity
- Failed admin login attempts alert the store owner after five failures
