import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from "./password";

describe("checkPasswordStrength", () => {
  it("accepts a long ordinary passphrase", () => {
    expect(checkPasswordStrength("correct horse battery staple").ok).toBe(true);
  });

  it("requires at least ten characters, per docs/07", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);

    const result = checkPasswordStrength("short");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("10 characters");
  });

  it("accepts exactly the minimum length", () => {
    expect(checkPasswordStrength("abcdefghij").ok).toBe(true);
  });

  it("has no composition rules — length beats symbols", () => {
    // All lowercase, no digits, no symbols. docs/07 is explicit that this is fine.
    expect(checkPasswordStrength("alllowercaseletters").ok).toBe(true);
  });

  it("rejects common passwords regardless of case", () => {
    for (const candidate of ["password123", "PASSWORD123", "Password123", "qwertyuiop"]) {
      const result = checkPasswordStrength(candidate);
      expect(result.ok, `${candidate} should be rejected`).toBe(false);
    }
  });

  it("refuses an absurdly long password before spending CPU hashing it", () => {
    expect(checkPasswordStrength("a".repeat(1000)).ok).toBe(false);
  });
});

describe("hashPassword and verifyPassword", () => {
  it("round-trips", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "incorrect horse battery staple")).resolves.toBe(false);
  });

  it("produces an argon2id hash, not bcrypt", async () => {
    expect(await hashPassword("correct horse battery staple")).toMatch(/^\$argon2id\$/);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
  });

  it("returns false on a malformed stored hash instead of throwing", async () => {
    // A corrupt row should be a failed login, not a 500 that confirms the row exists.
    await expect(verifyPassword("not-a-hash", "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
  });
});
