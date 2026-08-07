import type { MetadataRoute } from "next";

import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/seo";

/**
 * The sitemap.
 *
 * Only pages a stranger can usefully open: active products, categories that actually hold
 * something, and the policy pages. Drafts, archived products, and anything behind a sign-in are
 * absent — a sitemap listing URLs that 404 or redirect teaches a crawler to trust it less.
 *
 * `lastModified` comes from the row rather than from now(). A sitemap that claims everything
 * changed today is a sitemap whose dates are ignored.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([
    db.product.findMany({
      where: { status: "active", variants: { some: { isActive: true } } },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      // Well below the 50,000-URL limit, and far above the catalogue's realistic size. If this
      // is ever hit, the sitemap needs splitting rather than raising.
      take: 10_000,
    }),
    db.category.findMany({
      // A category page with nothing on it is a thin page, and thin pages drag a domain down.
      where: { products: { some: { status: "active" } } },
      select: { slug: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/products"), lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/terms"), changeFrequency: "yearly", priority: 0.3 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.3 },
    { url: absoluteUrl("/returns"), changeFrequency: "yearly", priority: 0.4 },
  ];

  return [
    ...staticPages,
    ...categories.map((category) => ({
      url: absoluteUrl(`/c/${category.slug}`),
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...products.map((product) => ({
      url: absoluteUrl(`/products/${product.slug}`),
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
