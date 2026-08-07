import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP — RFC 6238, over HOTP — RFC 4226.
 *
 * Written here rather than pulled in as a dependency. The algorithm is sixty lines of HMAC and
 * a base32 codec, both RFCs publish test vectors, and `totp.test.ts` checks this against them —
 * which is a stronger guarantee than trusting an unaudited package with the thing that stands
 * between a stolen admin password and the shop.
 */

/** RFC 4648 base32, which is what every authenticator app expects in an otpauth:// URI. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];

  // No "=" padding: authenticator apps accept it, but people retype these by hand and the
  // padding is the character they most often drop or mistype.
  return output;
}

export function base32Decode(input: string): Buffer {
  // Tolerant of what a human types: spaces, lower case, and the padding we do not emit.
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Not valid base32");

    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** 20 bytes — the SHA-1 block size RFC 4226 recommends, and what every app expects. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export interface TotpOptions {
  digits?: number;
  /** Seconds per step. 30 is what every authenticator app assumes. */
  period?: number;
  algorithm?: "sha1" | "sha256" | "sha512";
}

/** HOTP — RFC 4226 section 5.3. The counter is the time step for TOTP. */
function hotp(secret: Buffer, counter: number, options: TotpOptions = {}): string {
  const digits = options.digits ?? 6;

  // 8-byte big-endian counter. Written as two 32-bit halves because a JS number cannot hold
  // 64 bits, and the high half is zero until the year 10 000 anyway.
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac(options.algorithm ?? "sha1", secret)
    .update(buffer)
    .digest();

  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totp(secretBase32: string, atMs: number, options: TotpOptions = {}): string {
  const period = options.period ?? 30;
  const counter = Math.floor(atMs / 1000 / period);
  return hotp(base32Decode(secretBase32), counter, options);
}

/**
 * Checks a code against the current step and one either side.
 *
 * The ±1 window is RFC 6238's own suggestion, and it is not slack for its own sake: phone
 * clocks drift, and a code entered at 29.8 seconds arrives after the step has rolled. One step
 * costs 30 seconds of extra validity and removes most of the support burden of having 2FA.
 *
 * Compared in constant time. The comparison is short, but a timing oracle on a six-digit code
 * is a real reduction in the work of guessing it.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number,
  options: TotpOptions & { window?: number } = {}
): boolean {
  const digits = options.digits ?? 6;
  const entered = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(entered)) return false;

  const period = options.period ?? 30;
  const window = options.window ?? 1;
  const counter = Math.floor(atMs / 1000 / period);

  let matched = false;
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = hotp(base32Decode(secretBase32), counter + drift, options);
    const a = Buffer.from(expected);
    const b = Buffer.from(entered);
    // Every candidate is compared even after a match, so the number of comparisons does not
    // depend on which step matched.
    if (a.length === b.length && timingSafeEqual(a, b)) matched = true;
  }

  return matched;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer appears twice — once as a label prefix and once as a parameter — because older
 * apps read only one of them, and an entry labelled just "ramon@" is unidentifiable in a list
 * of twenty.
 */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params}`;
}
