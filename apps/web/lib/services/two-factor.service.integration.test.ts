import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { totp } from "@/lib/auth/totp";

import {
  confirmEnrolment,
  disable,
  reset,
  startEnrolment,
  status,
  twoFactorRequired,
  verifyChallenge,
} from "./two-factor.service";

/**
 * The P5-03 criterion: admin two-factor.
 *
 * The properties worth proving are the ones that would let it be bypassed rather than merely
 * be inconvenient — a recovery code that works twice, a secret that leaks, an enrolment that
 * enables before it is confirmed, or a required account able to switch it off.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.recoveryCode.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
}

async function makeUser(role = "admin") {
  return db.user.create({
    data: { name: "Ramon", email: `${unique("u")}@example.test`, role: role as never },
  });
}

/** Enrols an account and hands back the secret and its recovery codes. */
async function enrol(userId: string) {
  const started = await startEnrolment(db, userId);
  if ("kind" in started) throw new Error("already enabled");

  const result = await confirmEnrolment(db, userId, totp(started.secret, Date.now()));
  if (result.kind !== "ok") throw new Error(result.kind);

  return { secret: started.secret, codes: result.recoveryCodes };
}

describeIntegration("two-factor.service", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("who needs it", () => {
    it("requires it of admins and staff, not customers", () => {
      // A shop that demands an authenticator app to buy coffee loses the sale.
      expect(twoFactorRequired("admin")).toBe(true);
      expect(twoFactorRequired("staff")).toBe(true);
      expect(twoFactorRequired("customer")).toBe(false);
    });
  });

  describe("enrolment", () => {
    it("does not enable anything until a code is confirmed", async () => {
      // Enabling on `start` would lock out anyone who mis-scans the setup key.
      const user = await makeUser();
      await startEnrolment(db, user.id);

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.totpSecret).not.toBeNull();
      expect(after.totpEnabledAt).toBeNull();
      expect((await status(db, user.id)).enabled).toBe(false);
    });

    it("refuses to confirm with the wrong code", async () => {
      const user = await makeUser();
      await startEnrolment(db, user.id);

      expect((await confirmEnrolment(db, user.id, "000000")).kind).toBe("bad_code");
      expect((await status(db, user.id)).enabled).toBe(false);
    });

    it("enables it and issues ten recovery codes on a correct one", async () => {
      const user = await makeUser();
      const { codes } = await enrol(user.id);

      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      expect((await status(db, user.id)).enabled).toBe(true);
    });

    it("never stores a recovery code in readable form", async () => {
      // A table of plaintext bypass codes is a second password column for every admin at once.
      const user = await makeUser();
      const { codes } = await enrol(user.id);

      const rows = await db.recoveryCode.findMany({ where: { userId: user.id } });
      const stored = JSON.stringify(rows);
      for (const code of codes) {
        expect(stored).not.toContain(code);
        expect(stored).not.toContain(code.replace("-", ""));
      }
    });

    it("refuses to start again once it is on", async () => {
      const user = await makeUser();
      await enrol(user.id);

      const again = await startEnrolment(db, user.id);
      expect(again).toEqual({ kind: "already_enabled" });
    });

    it("keeps the secret out of the audit log", async () => {
      const user = await makeUser();
      await enrol(user.id);

      const entry = await db.auditLog.findFirstOrThrow({
        where: { action: "user.two_factor_enabled" },
      });
      const secret = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).totpSecret;

      expect(secret).not.toBeNull();
      expect(JSON.stringify(entry)).not.toContain(secret as string);
    });
  });

  describe("the sign-in challenge", () => {
    it("accepts the current authenticator code", async () => {
      const user = await makeUser();
      const { secret } = await enrol(user.id);

      const result = await verifyChallenge(db, user.id, totp(secret, Date.now()));
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.usedRecoveryCode).toBe(false);
    });

    it("refuses a wrong code", async () => {
      const user = await makeUser();
      await enrol(user.id);

      expect((await verifyChallenge(db, user.id, "000000")).kind).toBe("bad_code");
    });

    it("refuses a code from someone else's secret", async () => {
      const user = await makeUser();
      const other = await makeUser();
      await enrol(user.id);
      const theirs = await enrol(other.id);

      expect((await verifyChallenge(db, user.id, totp(theirs.secret, Date.now()))).kind).toBe(
        "bad_code"
      );
    });

    it("accepts a recovery code", async () => {
      const user = await makeUser();
      const { codes } = await enrol(user.id);

      const result = await verifyChallenge(db, user.id, codes[0]!);
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.usedRecoveryCode).toBe(true);
        expect(result.remainingCodes).toBe(9);
      }
    });

    it("burns a recovery code, so it cannot be used twice", async () => {
      // The whole point of single use. Someone reading one off a screenshot must not get in.
      const user = await makeUser();
      const { codes } = await enrol(user.id);

      expect((await verifyChallenge(db, user.id, codes[0]!)).kind).toBe("ok");
      expect((await verifyChallenge(db, user.id, codes[0]!)).kind).toBe("bad_code");
    });

    it("accepts a recovery code however it was written down", async () => {
      const user = await makeUser();
      const { codes } = await enrol(user.id);

      // Lower case and without the grouping dash.
      const typed = codes[0]!.toLowerCase().replace("-", "");
      expect((await verifyChallenge(db, user.id, typed)).kind).toBe("ok");
    });

    it("refuses everything when two-factor is not enabled", async () => {
      const user = await makeUser();
      expect((await verifyChallenge(db, user.id, "000000")).kind).toBe("bad_code");
    });

    it("records that a recovery code was spent", async () => {
      // Worth noticing: it usually means someone lost a phone, and sometimes it does not.
      const user = await makeUser();
      const { codes } = await enrol(user.id);
      await verifyChallenge(db, user.id, codes[0]!);

      const entry = await db.auditLog.findFirstOrThrow({
        where: { action: "user.recovery_code_used" },
      });
      expect(entry.after).toMatchObject({ remainingCodes: 9 });
    });
  });

  describe("turning it off", () => {
    it("refuses for an account that is required to have it", async () => {
      // Otherwise the requirement is a suggestion.
      const user = await makeUser("admin");
      const { secret } = await enrol(user.id);

      const result = await disable(db, user.id, totp(secret, Date.now()));
      expect(result.kind).toBe("required");
      expect((await status(db, user.id)).enabled).toBe(true);
    });

    it("lets a customer turn it off with a current code", async () => {
      const user = await makeUser("customer");
      const { secret } = await enrol(user.id);

      expect((await disable(db, user.id, totp(secret, Date.now()))).kind).toBe("ok");
      expect((await status(db, user.id)).enabled).toBe(false);
      expect(await db.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
    });

    it("refuses to turn it off without a code", async () => {
      // A stolen password must not be able to remove the thing protecting against it.
      const user = await makeUser("customer");
      await enrol(user.id);

      expect((await disable(db, user.id, "000000")).kind).toBe("bad_code");
      expect((await status(db, user.id)).enabled).toBe(true);
    });
  });

  describe("resetting onto a new phone", () => {
    it("issues a new secret and revokes the old codes", async () => {
      const user = await makeUser();
      const first = await enrol(user.id);

      const restarted = await reset(db, user.id);
      expect(restarted.secret).not.toBe(first.secret);

      // The old recovery codes go with the old secret.
      expect(await db.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
      expect((await status(db, user.id)).enabled).toBe(false);

      // And the old authenticator no longer works once the new one is confirmed.
      await confirmEnrolment(db, user.id, totp(restarted.secret, Date.now()));
      expect((await verifyChallenge(db, user.id, totp(first.secret, Date.now()))).kind).toBe(
        "bad_code"
      );
    });
  });

  describe("status", () => {
    it("never returns the secret", async () => {
      const user = await makeUser();
      await enrol(user.id);

      const reported = await status(db, user.id);
      expect(JSON.stringify(reported)).not.toContain("secret");
      expect(reported).toMatchObject({ enabled: true, required: true, remainingCodes: 10 });
    });
  });
});
