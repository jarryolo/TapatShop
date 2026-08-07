import type { MetadataRoute } from "next";

import { absoluteUrl, IS_INDEXABLE } from "@/lib/seo";

/**
 * robots.txt.
 *
 * Two jobs. Keep crawlers out of anything that is private, per-session, or pointless to index;
 * and keep them out of a staging deployment entirely.
 *
 * Note what this is *not*: a security control. Everything under /admin is gated by middleware
 * and re-checked in every route handler — docs/02. Listing a path here tells a well-behaved
 * crawler not to bother, and tells everyone else exactly where to look, which is why the
 * paths below are ones whose existence is already obvious.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_INDEXABLE) {
    // Staging and local. A blanket refusal beats a partial one nobody remembers to tighten.
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/account/",
          "/cart",
          "/checkout",
          "/wishlist",
          "/signin",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/recover-account",
          "/orders/track",
          "/dev/",
          // Sorted and filtered listings are the same products rearranged. The canonical
          // already points at the plain URL; this saves the crawl budget as well.
          "/*?sort=",
          "/*?minPrice=",
          "/*?maxPrice=",
          "/*?brand=",
          "/*?q=",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
