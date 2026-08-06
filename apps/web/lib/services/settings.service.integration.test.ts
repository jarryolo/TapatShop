import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listSettings, readSetting, saveSetting } from "./settings.service";

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let actor = { id: "", ip: "203.0.113.4" };

async function wipe() {
  await db.setting.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
}

describeIntegration("settings.service", () => {
  beforeEach(async () => {
    await wipe();
    const admin = await db.user.create({
      data: { name: "Ramon", email: `${unique("a")}@example.test`, role: "admin" },
    });
    actor = { id: admin.id, ip: "203.0.113.4" };
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it("saves a value and audits who changed it", async () => {
    expect((await saveSetting(db, "store_name", "TapatShop", actor)).kind).toBe("ok");

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "setting.update" } });
    expect(entry.actorId).toBe(actor.id);
    expect(entry.entityId).toBe("store_name");
    expect(entry.after).toMatchObject({ value: "TapatShop" });
  });

  it("records what the value was before", async () => {
    await saveSetting(db, "member_discount_percent", 10, actor);
    await db.auditLog.deleteMany();
    await saveSetting(db, "member_discount_percent", 15, actor);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "setting.update" } });
    expect(entry.before).toMatchObject({ value: 10 });
    expect(entry.after).toMatchObject({ value: 15 });
  });

  it("refuses a key that is not declared", async () => {
    // A typo would otherwise save cleanly and read as nothing everywhere.
    const result = await saveSetting(db, "member_discount_percnt", 10, actor);
    expect(result.kind).toBe("unknown_key");
    expect(await db.setting.count()).toBe(0);
  });

  it("range-checks an integer setting", async () => {
    expect((await saveSetting(db, "member_discount_percent", 101, actor)).kind).toBe("invalid");
    expect((await saveSetting(db, "member_discount_percent", -1, actor)).kind).toBe("invalid");
    expect((await saveSetting(db, "member_discount_percent", 7.5, actor)).kind).toBe("invalid");
    expect((await saveSetting(db, "member_discount_percent", 100, actor)).kind).toBe("ok");
  });

  it("lets the member discount be set to zero, which turns member pricing off", async () => {
    // docs/01 depends on this working without a code change.
    expect((await saveSetting(db, "member_discount_percent", 0, actor)).kind).toBe("ok");
    expect(await readSetting(db, "member_discount_percent", 10)).toBe(0);
  });

  it("keeps a boolean a boolean", async () => {
    expect((await saveSetting(db, "absorb_payment_fees", "yes", actor)).kind).toBe("invalid");
    expect((await saveSetting(db, "absorb_payment_fees", true, actor)).kind).toBe("ok");
    expect(await readSetting(db, "absorb_payment_fees", false)).toBe(true);
  });

  describe("secrets", () => {
    it("never reads a payment key back", async () => {
      await saveSetting(db, "paymongo_secret_key", "sk_test_NOT_A_REAL_KEY", actor);

      const listed = await listSettings(db);
      const secret = listed.find((row) => row.key === "paymongo_secret_key");

      expect(secret?.isSet).toBe(true);
      expect(secret?.value).toBeNull();
      // Nothing in the whole payload, not just that one field.
      expect(JSON.stringify(listed)).not.toContain("sk_test");
    });

    it("keeps a payment key out of the audit log", async () => {
      // The log is the table most likely to be exported into a spreadsheet.
      await saveSetting(db, "paymongo_webhook_secret", "whsec_NOT_A_REAL_SECRET", actor);

      const entry = await db.auditLog.findFirstOrThrow({
        where: { entityId: "paymongo_webhook_secret" },
      });
      expect(JSON.stringify(entry)).not.toContain("whsec_");
      // But the fact of the change, and who made it, is recorded.
      expect(entry.actorId).toBe(actor.id);
      expect(entry.after).toMatchObject({ isSet: true });
    });

    it("still stores the value, so the code that needs it can read it", async () => {
      await saveSetting(db, "paymongo_secret_key", "sk_test_NOT_A_REAL_KEY", actor);
      expect(await readSetting(db, "paymongo_secret_key", "")).toBe("sk_test_NOT_A_REAL_KEY");
    });

    it("reports a secret that has never been set", async () => {
      const secret = (await listSettings(db)).find((row) => row.key === "paymongo_secret_key");
      expect(secret?.isSet).toBe(false);
    });

    it("clears a secret by saving an empty value, and then reports it unset", async () => {
      await saveSetting(db, "paymongo_secret_key", "sk_test_NOT_A_REAL_KEY", actor);
      await saveSetting(db, "paymongo_secret_key", "", actor);

      const secret = (await listSettings(db)).find((row) => row.key === "paymongo_secret_key");
      expect(secret?.isSet).toBe(false);
      // Deleted rather than blanked, so nothing reads an empty string as a key.
      expect(await db.setting.findUnique({ where: { key: "paymongo_secret_key" } })).toBeNull();
    });

    it("never selects a secret's value on the read path at all", async () => {
      /**
       * The stronger claim, and the one that matters.
       *
       * Masking a value already in hand still puts the plaintext inside a Server Component
       * render — and Next's dev build ships the resolved value of every awaited promise to
       * the browser for its performance timeline, which put a live key in the page source.
       * This asserts the value never enters the process, so there is nothing to ship.
       */
      await saveSetting(db, "paymongo_secret_key", "sk_test_NOT_A_REAL_KEY", actor);

      const queries: string[] = [];
      const spy = new PrismaClient({
        datasources: { db: { url: url ?? "mysql://unused" } },
        log: [{ emit: "event", level: "query" }],
      });
      spy.$on("query" as never, (event: { query: string }) => queries.push(event.query));

      await listSettings(spy);
      await spy.$disconnect();

      const settingReads = queries.filter((query) => /FROM `?\w*`?\.?`?settings`?/i.test(query));
      expect(settingReads.length).toBeGreaterThan(0);

      // The query that reads the secret keys must not name the value column.
      const readsSecretValue = settingReads.some(
        (query) =>
          /paymongo|IN \(\?/i.test(query) && /`value`/i.test(query) && !/notIn|NOT IN/i.test(query)
      );
      expect(readsSecretValue).toBe(false);
    });
  });

  it("lists every declared setting even before any is saved", async () => {
    const listed = await listSettings(db);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((row) => row.label.length > 0)).toBe(true);
    expect(listed.find((row) => row.key === "store_name")?.isSet).toBe(false);
  });

  it("falls back when a setting has never been written", async () => {
    expect(await readSetting(db, "member_discount_percent", 10)).toBe(10);
  });
});
