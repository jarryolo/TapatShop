import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";

import { log } from "./audit.service";

/**
 * Homepage banners and the announcement bar — docs/01's "Content" scope.
 *
 * The announcement itself is a setting, not a row: it is one string with no schedule and no
 * ordering, and giving it a table would mean two places to look for what the shop is saying.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Matches what the seed and `homeShelves` already use. `home_secondary` is not a name I would
 * have picked, but renaming it would orphan every existing row into a placement nothing reads.
 */
export const PLACEMENTS = ["home_hero", "home_secondary", "category_top"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/**
 * A banner is live only inside its window.
 *
 * `isActive` is the manual switch; the dates are the schedule. Both have to agree, which is
 * what lets someone set up a Christmas banner in October and stop thinking about it.
 *
 * The home page revalidates every 300 seconds, so a start or end takes effect up to five
 * minutes late. That is fine for a banner and would not be for a price — worth knowing before
 * anyone reaches for this pattern to schedule something that costs money.
 */
export function liveWhere(now: Date, placement?: Placement): Prisma.BannerWhereInput {
  return {
    isActive: true,
    ...(placement ? { placement } : {}),
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}

export function liveBanners(tx: Db, placement: Placement, now: Date = new Date(), take = 5) {
  return tx.banner.findMany({
    where: liveWhere(now, placement),
    orderBy: { sortOrder: "asc" },
    take,
  });
}

/** Everything, live or not — the admin needs to see what is scheduled and what has lapsed. */
export function listBanners(tx: Db) {
  return tx.banner.findMany({ orderBy: [{ placement: "asc" }, { sortOrder: "asc" }] });
}

export interface BannerWrite {
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
  placement: Placement;
  sortOrder?: number;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

type Actor = { id: string; ip?: string | null; userAgent?: string | null };

export async function createBanner(tx: Db, input: BannerWrite, actor: Actor) {
  const banner = await tx.banner.create({ data: input });

  await log(tx, {
    actorId: actor.id,
    action: "banner.create",
    entity: "Banner",
    entityId: banner.id,
    after: banner,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return banner;
}

export async function updateBanner(
  tx: Db,
  id: string,
  input: Partial<BannerWrite>,
  actor: Actor
): Promise<{ kind: "ok" } | { kind: "not_found" }> {
  const before = await tx.banner.findUnique({ where: { id } });
  if (!before) return { kind: "not_found" };

  const after = await tx.banner.update({ where: { id }, data: input });

  await log(tx, {
    actorId: actor.id,
    action: "banner.update",
    entity: "Banner",
    entityId: id,
    before,
    after,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok" };
}

export async function deleteBanner(
  tx: Db,
  id: string,
  actor: Actor
): Promise<{ kind: "ok" } | { kind: "not_found" }> {
  const before = await tx.banner.findUnique({ where: { id } });
  if (!before) return { kind: "not_found" };

  // Nothing references a banner, so this really is a delete rather than a deactivation.
  await tx.banner.delete({ where: { id } });

  await log(tx, {
    actorId: actor.id,
    action: "banner.delete",
    entity: "Banner",
    entityId: id,
    before,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok" };
}

export const contentService = {
  list: () => listBanners(db),
  live: (placement: Placement, now?: Date) => liveBanners(db, placement, now),
  create: (input: BannerWrite, actor: Actor) =>
    db.$transaction((tx) => createBanner(tx, input, actor)),
  update: (id: string, input: Partial<BannerWrite>, actor: Actor) =>
    db.$transaction((tx) => updateBanner(tx, id, input, actor)),
  remove: (id: string, actor: Actor) => db.$transaction((tx) => deleteBanner(tx, id, actor)),
};
