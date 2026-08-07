import type { Metadata } from "next";

/**
 * One place that knows the site's public address, and the helpers that depend on it.
 *
 * Everything here is about telling search engines and link previews the truth. The two ways
 * that goes wrong are lying (structured data claiming a rating nobody left, or a price only
 * some people can get) and duplicating (the same products reachable at a dozen filtered URLs,
 * each competing with the others). Both are handled below rather than page by page.
 */

/** Trailing slash removed, so joins never produce a double slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);

export const SITE_NAME = "TapatShop";

/**
 * Whether this deployment should be indexed at all.
 *
 * A staging copy in the index competes with the real shop for its own listings, and the
 * cleanup is slow. Anything that is not a production build says no.
 */
export const IS_INDEXABLE =
  process.env.NODE_ENV === "production" && !SITE_URL.includes("localhost");

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The canonical for a listing page.
 *
 * Filters and sort are deliberately dropped. `?sort=price_asc&page=2` shows a rearrangement of
 * the same products, and left canonical to itself every combination becomes a separate page
 * competing with the one that should rank. Pagination keeps its `page` parameter, because page
 * two genuinely holds different products.
 */
export function listingCanonical(path: string, params: Record<string, string | undefined>): string {
  const page = Number(params.page ?? "1");
  const query = page > 1 ? `?page=${page}` : "";
  return absoluteUrl(`${path}${query}`);
}

/** Metadata shared by every public page: canonical, Open Graph, and the OG image. */
export function pageMetadata(input: {
  title: string;
  description?: string;
  path: string;
  /**
   * Leave unset to use the site-wide card. Pass `"generated"` when the route segment has its
   * own `opengraph-image` file.
   *
   * That distinction matters: naming `images` here **overrides** Next's file convention, so a
   * page with a perfectly good generated card would silently fall back to the generic one.
   * Omitting the key entirely is what lets the file win.
   */
  ogImage?: "generated";
  type?: "website" | "article";
}): Metadata {
  const url = absoluteUrl(input.path);
  const useFileConvention = input.ogImage === "generated";
  const image = absoluteUrl("/opengraph-image");

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      siteName: SITE_NAME,
      locale: "en_PH",
      type: input.type ?? "website",
      ...(useFileConvention
        ? {}
        : { images: [{ url: image, width: 1200, height: 630, alt: input.title }] }),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      ...(useFileConvention ? {} : { images: [image] }),
    },
  };
}

/**
 * A `<script type="application/ld+json">` payload, escaped.
 *
 * `</script>` inside a product description would otherwise close the tag early and put the
 * rest of the JSON into the page as markup — which is both a broken page and an injection
 * point, since the description is admin-entered text.
 */
export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}
