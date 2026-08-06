import { describe, expect, it } from "vitest";

import { LIMITS, clientIp, rateLimitKey } from "./rate-limit";

describe("rateLimitKey", () => {
  it("lowercases identifiers so case variation is not a free bypass", () => {
    expect(rateLimitKey("login", "1.2.3.4", "Joel@Example.com")).toBe(
      rateLimitKey("login", "1.2.3.4", "joel@example.com")
    );
  });

  it("keys the IP and identifier together, not separately", () => {
    // docs/04 says "5/min per email + IP" — the pair. Two customers behind the same NAT
    // must not spend each other's attempts.
    const alice = rateLimitKey("login", "1.2.3.4", "alice@example.com");
    const bob = rateLimitKey("login", "1.2.3.4", "bob@example.com");

    expect(alice).not.toBe(bob);
  });

  it("separates the same identifier arriving from different addresses", () => {
    expect(rateLimitKey("login", "1.2.3.4", "joel@example.com")).not.toBe(
      rateLimitKey("login", "5.6.7.8", "joel@example.com")
    );
  });

  it("drops empty parts rather than producing a trailing separator", () => {
    expect(rateLimitKey("ipCeiling", "1.2.3.4")).toBe("ipCeiling:1.2.3.4");
    expect(rateLimitKey("login", "1.2.3.4", "")).toBe("login:1.2.3.4");
  });
});

describe("clientIp", () => {
  it("takes the first hop from x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" });
    expect(clientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("returns a constant when there is no proxy header", () => {
    // Everything unattributable shares one bucket. That is the safe direction to fail.
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("LIMITS", () => {
  it("matches the numbers in docs/04", () => {
    expect(LIMITS.login).toEqual({ limit: 5, windowSeconds: 60 });
    expect(LIMITS.register).toEqual({ limit: 5, windowSeconds: 60 });
    expect(LIMITS.passwordReset).toEqual({ limit: 3, windowSeconds: 3600 });
    expect(LIMITS.orderTracking).toEqual({ limit: 5, windowSeconds: 60 });
    expect(LIMITS.checkoutSession).toEqual({ limit: 10, windowSeconds: 60 });
    expect(LIMITS.searchSuggest).toEqual({ limit: 30, windowSeconds: 60 });
    expect(LIMITS.default).toEqual({ limit: 120, windowSeconds: 60 });
  });

  it("keeps the per-IP ceiling above the per-pair limits and below the general default", () => {
    // It has to be loose enough that a household or office is not throttled, and tight
    // enough that spraying one password across many accounts still hits it.
    expect(LIMITS.ipCeiling.limit).toBeGreaterThan(LIMITS.login.limit);
    expect(LIMITS.ipCeiling.limit).toBeLessThan(LIMITS.default.limit);
  });

  it("does not spend login attempts on a sign-in method lookup", () => {
    expect(LIMITS.signInMethods.limit).toBeGreaterThan(LIMITS.login.limit);
  });
});
