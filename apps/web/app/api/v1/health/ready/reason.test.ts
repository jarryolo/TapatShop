import { describe, expect, it } from "vitest";

import { reasonFrom } from "./route";

/**
 * The readiness probe's error line.
 *
 * Two things have to hold at once and they pull against each other: the line has to say enough
 * to act on, and it must never carry a credential. Both got broken during P5-04 — first the
 * detail was dropped entirely, then it came back as Prisma's boilerplate opener.
 */

/** What Prisma actually produces: blank opener, code frame, then the cause. */
const PRISMA_AUTH_FAILURE = `
Invalid \`prisma.$queryRaw()\` invocation:


  41 const db = new PrismaClient()
→ 44   await db.$queryRaw(
Authentication failed against database server, the provided database credentials for \`tapat\` are not valid.

Please make sure to provide valid database credentials for the database server at the configured address.`;

describe("reasonFrom", () => {
  it("skips the boilerplate opener", () => {
    // "Invalid prisma.$queryRaw() invocation:" is the first line and says nothing.
    expect(reasonFrom(new Error(PRISMA_AUTH_FAILURE))).not.toContain("invocation");
  });

  it("skips the code frame", () => {
    const reason = reasonFrom(new Error(PRISMA_AUTH_FAILURE));
    expect(reason).not.toContain("new PrismaClient");
    expect(reason).not.toMatch(/^→/);
  });

  it("returns something a person can act on", () => {
    const reason = reasonFrom(new Error(PRISMA_AUTH_FAILURE));
    expect(reason.length).toBeGreaterThan(20);
    expect(reason.toLowerCase()).toContain("credentials");
  });

  it("never echoes a connection string", () => {
    // The single rule that matters: this endpoint is reachable by whatever polls it.
    const leaky = new Error(
      "Can't reach database server at mysql://tapat:hunter2@localhost:3306/tapatshop"
    );
    const reason = reasonFrom(leaky);

    expect(reason).not.toContain("hunter2");
    expect(reason).not.toContain("mysql://");
    expect(reason).toContain("[redacted]");
  });

  it("redacts a redis URL too", () => {
    const reason = reasonFrom(new Error("connect ECONNREFUSED redis://:secret@localhost:6379"));
    expect(reason).not.toContain("secret");
    expect(reason).toContain("[redacted]");
  });

  it("handles a plain error with one line", () => {
    expect(reasonFrom(new Error("timed out after 3000ms"))).toBe("timed out after 3000ms");
  });

  it("handles something that is not an Error at all", () => {
    expect(reasonFrom("just a string")).toBe("failed");
    expect(reasonFrom(undefined)).toBe("failed");
  });

  it("handles an error with nothing usable in it", () => {
    expect(reasonFrom(new Error("   \n\n  "))).toBe("failed");
  });

  it("caps the length, so a huge stack cannot become the response body", () => {
    expect(reasonFrom(new Error("x".repeat(5_000)))).toHaveLength(140);
  });
});
