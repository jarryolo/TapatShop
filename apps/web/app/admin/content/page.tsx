import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { listBanners } from "@/lib/services/content.service";
import { readSetting } from "@/lib/services/settings.service";

import { BannersView, type BannerRow } from "./banners-view";

export const metadata: Metadata = { title: "Content — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminContentPage() {
  const [banners, announcement] = await Promise.all([
    listBanners(db),
    readSetting(db, "announcement", ""),
  ]);

  const rows: BannerRow[] = banners.map((banner) => ({
    id: banner.id,
    title: banner.title,
    subtitle: banner.subtitle,
    imageUrl: banner.imageUrl,
    linkUrl: banner.linkUrl,
    placement: banner.placement,
    sortOrder: banner.sortOrder,
    isActive: banner.isActive,
    startsAt: banner.startsAt?.toISOString() ?? null,
    endsAt: banner.endsAt?.toISOString() ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Content</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          What the shop shows above the products. A banner is live only when it is active and inside
          its dates.
        </p>
      </header>

      <BannersView rows={rows} />

      <Card>
        <CardHeader>
          <CardTitle>Announcement bar</CardTitle>
        </CardHeader>
        <p className="mt-1 text-sm text-text-muted">
          One line across the top of the shop. It is a setting rather than a banner because it has
          no image, no schedule and no ordering — edit it under{" "}
          <Link href="/admin/settings" className="font-semibold text-brand-600 hover:underline">
            settings
          </Link>
          .
        </p>
        <p className="mt-3 rounded-[var(--radius-ctrl)] bg-surface-sunken px-4 py-3 text-sm">
          {announcement ? announcement : <span className="text-text-muted">Nothing showing.</span>}
        </p>
      </Card>
    </div>
  );
}
