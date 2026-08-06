import { describe, expect, it } from "vitest";

import {
  RESET_TOKEN_TTL_MINUTES,
  generateOtp,
  generateToken,
  hashToken,
  resetTokenExpiry,
  tokensMatch,
  verifyTokenExpiry,
} from "./tokens";

describe("generateToken", () => {
  it("is URL-safe, so it survives being put in a link", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("carries at least 32 bytes of entropy", () => {
    // base64url of 32 bytes is 43 characters.
    expect(generateToken().length).toBeGreaterThanOrEqual(43);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(seen.size).toBe(500);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("does not contain the token, which is the whole point of storing the hash", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it("produces a 64-character hex digest", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes completely for a one-character difference", () => {
    const a = hashToken("token-a");
    const b = hashToken("token-b");

    const shared = [...a].filter((char, i) => char === b[i]).length;
    // Two unrelated 64-char hex strings share about 4 positions by chance. Anything close to
    // 64 would mean the hash is leaking structure.
    expect(shared).toBeLessThan(20);
  });
});

describe("tokensMatch", () => {
  it("matches identical hashes", () => {
    const hash = hashToken("same");
    expect(tokensMatch(hash, hash)).toBe(true);
  });

  it("rejects different hashes", () => {
    expect(tokensMatch(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("rejects empty input rather than treating it as a match", () => {
    expect(tokensMatch("", "")).toBe(false);
  });

  it("rejects length mismatches without throwing", () => {
    expect(tokensMatch("abcd", hashToken("a"))).toBe(false);
  });
});

describe("expiry", () => {
  it("expires a reset link in 30 minutes, per docs/07", () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    const expiry = resetTokenExpiry(now);

    expect(expiry.getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MINUTES * 60_000);
    expect(RESET_TOKEN_TTL_MINUTES).toBe(30);
  });

  it("gives verification links longer, since they get opened late", () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    expect(verifyTokenExpiry(now).getTime()).toBeGreaterThan(resetTokenExpiry(now).getTime());
  });
});

describe("generateOtp", () => {
  it("is always six digits, including leading zeros", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("is spread across the range rather than clustered", () => {
    const samples = Array.from({ length: 2000 }, () => Number(generateOtp()));
    const low = samples.filter((n) => n < 500_000).length;

    // Rejection sampling should put this near 1000. Plain `% 1000000` on a uint32 biases the
    // low half upward; a wide margin still catches a badly broken generator.
    expect(low).toBeGreaterThan(850);
    expect(low).toBeLessThan(1150);
  });
});
