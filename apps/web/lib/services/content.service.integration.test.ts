import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createBanner,
  deleteBanner,
  listBanners,
  liveBanners,
  updateBanner,
} from "./content.service";

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let actor = { id: "", ip: "203.0.113.7" };

const NOW = new Date("2026-08-07T04:00:00.000Z");
const DAY = 86_400_000;

async function wipe() {
  await db.banner.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: unique("Banner"),
    imageUrl: "https://cdn.example.test/banner.jpg",
    placement: "home_hero" as const,
    ...overrides,
  };
}

describeIntegration("content.service", () => {
  beforeEach(async () => {
    await wipe();
    const admin = await db.user.create({
      data: { name: "Ramon", email: `${unique("a")}@example.test`, role: "admin" },
    });
    actor = { id: admin.id, ip: "203.0.113.7" };
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("when a banner is live", () => {
    it("shows one with no dates at all", async () => {
      await createBanner(db, draft(), actor);
      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(1);
    });

    it("hides one that is switched off, dates or not", async () => {
      await createBanner(db, draft({ isActive: false }), actor);
      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(0);
    });

    it("hides one scheduled for later", async () => {
      // The point of a schedule: set up the Christmas banner in October and forget about it.
      await createBanner(db, draft({ startsAt: new Date(NOW.getTime() + DAY) }), actor);
      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(0);
    });

    it("shows it once its start has passed", async () => {
      await createBanner(db, draft({ startsAt: new Date(NOW.getTime() - DAY) }), actor);
      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(1);
    });

    it("hides one whose end has passed", async () => {
      // A sale banner has to stop on its own; nobody is awake to switch it off at midnight.
      await createBanner(db, draft({ endsAt: new Date(NOW.getTime() - DAY) }), actor);
      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(0);
    });

    it("shows it inside its window and hides it either side", async () => {
      await createBanner(
        db,
        draft({
          startsAt: new Date(NOW.getTime() - DAY),
          endsAt: new Date(NOW.getTime() + DAY),
        }),
        actor
      );

      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(1);
      expect(await liveBanners(db, "home_hero", new Date(NOW.getTime() - 2 * DAY))).toHaveLength(0);
      expect(await liveBanners(db, "home_hero", new Date(NOW.getTime() + 2 * DAY))).toHaveLength(0);
    });

    it("keeps placements apart", async () => {
      await createBanner(db, draft({ placement: "home_hero" }), actor);
      await createBanner(db, draft({ placement: "home_secondary" }), actor);

      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(1);
      expect(await liveBanners(db, "home_secondary", NOW)).toHaveLength(1);
    });

    it("orders by sortOrder, lowest first", async () => {
      await createBanner(db, draft({ title: "second", sortOrder: 5 }), actor);
      await createBanner(db, draft({ title: "first", sortOrder: 1 }), actor);

      expect((await liveBanners(db, "home_hero", NOW))[0]?.title).toBe("first");
    });
  });

  describe("the admin list", () => {
    it("shows scheduled and lapsed banners too", async () => {
      // The admin has to be able to see the ones that are not showing, or they cannot fix them.
      await createBanner(db, draft({ startsAt: new Date(NOW.getTime() + DAY) }), actor);
      await createBanner(db, draft({ endsAt: new Date(NOW.getTime() - DAY) }), actor);
      await createBanner(db, draft({ isActive: false }), actor);

      expect(await listBanners(db)).toHaveLength(3);
      expect(await liveBanners(db, "home_hero", NOW)).toHaveLength(0);
    });
  });

  describe("auditing", () => {
    it("records a creation", async () => {
      const banner = await createBanner(db, draft(), actor);

      const audit = await db.auditLog.findFirstOrThrow({ where: { action: "banner.create" } });
      expect(audit.actorId).toBe(actor.id);
      expect(audit.entityId).toBe(banner.id);
      expect(audit.ip).toBe("203.0.113.7");
    });

    it("records what an edit changed", async () => {
      const banner = await createBanner(db, draft({ isActive: true }), actor);
      await db.auditLog.deleteMany();

      await updateBanner(db, banner.id, { isActive: false }, actor);

      const audit = await db.auditLog.findFirstOrThrow({ where: { action: "banner.update" } });
      expect(audit.before).toMatchObject({ isActive: true });
      expect(audit.after).toMatchObject({ isActive: false });
    });

    it("records a deletion, including what was deleted", async () => {
      const banner = await createBanner(db, draft({ title: "Gone" }), actor);
      await deleteBanner(db, banner.id, actor);

      const audit = await db.auditLog.findFirstOrThrow({ where: { action: "banner.delete" } });
      // The row is gone, so the log is the only record that it ever existed.
      expect(audit.before).toMatchObject({ title: "Gone" });
      expect(await db.banner.findUnique({ where: { id: banner.id } })).toBeNull();
    });

    it("reports a missing banner rather than throwing", async () => {
      expect((await updateBanner(db, "nope", { title: "x" }, actor)).kind).toBe("not_found");
      expect((await deleteBanner(db, "nope", actor)).kind).toBe("not_found");
    });
  });
});
