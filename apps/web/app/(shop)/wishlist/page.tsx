import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberDiscountPercent } from "@/lib/services/catalog.service";
import { listWishlist } from "@/lib/services/wishlist.service";

import { WishlistView, type WishlistRow } from "./wishlist-view";

export const metadata: Metadata = {
  title: "Saved items — TapatShop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const session = await auth();
  // A wishlist belongs to someone, so there is nothing to show a guest.
  if (!session?.user?.id) redirect("/signin?callbackUrl=/wishlist");

  const isMember = Boolean(session.user.isMember && session.user.emailIsVerified);
  const percent = isMember ? await memberDiscountPercent() : 0;

  const items = await listWishlist(db, session.user.id, percent);

  const rows: WishlistRow[] = items.map((item) => ({
    id: item.id,
    productId: item.productId,
    name: item.name,
    slug: item.slug,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    priceCents: item.priceCents,
    memberPriceCents: item.memberPriceCents,
    inStock: item.inStock,
    available: item.available,
  }));

  return (
    <div className="mx-auto max-w-[880px] px-4 py-6 md:px-6 md:py-10">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Saved items</h1>
        <p className="mt-1 text-sm text-text-muted">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </p>
      </header>

      <div className="mt-6">
        <WishlistView rows={rows} isMember={isMember} />
      </div>
    </div>
  );
}
