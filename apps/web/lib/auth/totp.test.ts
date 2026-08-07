import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode, generateSecret, otpauthUri, totp, verifyTotp } from "./totp";

/**
 * Checked against the test vectors published in the RFCs themselves.
 *
 * This is the reason writing TOTP here beats adding a dependency: the specification ships
 * known-answer tests, so "does this implement RFC 6238" is a question with a definite answer
 * rather than a matter of trusting a package.
 */

/** RFC 6238 appendix B uses the ASCII seed "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("RFC 6238 test vectors", () => {
  // Appendix B, SHA-1 column. Times are seconds since the epoch.
  const vectors: [number, string][] = [
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
    [20_000_000_000, "353130"],
  ];

  for (const [seconds, expected] of vectors) {
    it(`matches at t=${seconds}`, () => {
      expect(totp(RFC_SECRET, seconds * 1000, { digits: 6 })).toBe(expected);
    });
  }
});

describe("RFC 4648 base32", () => {
  // Section 10's own test vectors.
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];

  for (const [plain, encoded] of vectors) {
    it(`encodes "${plain}"`, () => {
      expect(base32Encode(Buffer.from(plain, "ascii"))).toBe(encoded);
    });
  }

  it("round-trips random bytes", () => {
    const secret = generateSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it("forgives how a human types it", () => {
    // Lower case, spaces, and the padding this codec does not emit.
    const secret = generateSecret();
    const mangled = `${secret.toLowerCase().slice(0, 4)} ${secret.toLowerCase().slice(4)}==`;
    expect(base32Decode(mangled).equals(base32Decode(secret))).toBe(true);
  });

  it("refuses characters that are not base32", () => {
    // 0, 1 and 8 are excluded from the alphabet precisely because they look like O, I and B.
    expect(() => base32Decode("ABC!DEF")).toThrow();
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000_000;

  it("accepts the current code", () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(true);
  });

  it("accepts one step either side, for clock drift", () => {
    // A phone whose clock is half a minute out is common; locking those people out is not
    // security, it is a support queue.
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(true);
  });

  it("refuses a code two steps old", () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), now)).toBe(false);
  });

  it("refuses a wrong code", () => {
    expect(verifyTotp(RFC_SECRET, "000000", now)).toBe(false);
  });

  it("refuses anything that is not six digits", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toBe(false);
    }
  });

  it("ignores spaces, which apps insert for readability", () => {
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });

  it("refuses a code from a different secret", () => {
    const other = generateSecret();
    expect(verifyTotp(RFC_SECRET, totp(other, now), now)).toBe(false);
  });
});

describe("generateSecret", () => {
  it("is 160 bits, as RFC 4226 recommends", () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });

  it("is different every time", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe("otpauthUri", () => {
  it("names the issuer twice, so the entry is identifiable in a list", () => {
    const uri = otpauthUri("ABCDEFGH", "ramon@tapatshop.com", "TapatShop");

    expect(uri).toContain("otpauth://totp/TapatShop%3Aramon%40tapatshop.com");
    expect(uri).toContain("issuer=TapatShop");
    expect(uri).toContain("secret=ABCDEFGH");
  });
});
