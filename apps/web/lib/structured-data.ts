import type { ProductDetail } from "@/lib/services/catalog.service";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/lib/seo";

/**
 * schema.org payloads.
 *
 * The rule governing all of it: **never claim something that is not true on the page.** Google
 * treats structured data that disagrees with the visible page as a reason to distrust the whole
 * domain, and the two ways this goes wrong here are both tempting:
 *
 *   - an `aggregateRating` on a product nobody has reviewed. Emitted only when there is at
 *     least one approved review, because "0 out of 5" and "no rating" are different claims.
 *   - the member price as *the* price. Member pricing needs a verified membership, so quoting
 *     it to everyone would put a number in the search results that most people cannot get.
 *     The regular price is the one advertised.
 */

/** Prices in schema.org are decimal strings, not centavos. */
function pesos(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function organizationJsonLd(storeName: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: storeName || SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/opengraph-image"),
  };
}

export function websiteJsonLd(storeName: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: storeName || SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/products?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/**
 * A product, with one offer per variant.
 *
 * `AggregateOffer` rather than a single `Offer` when there is more than one variant, because a
 * shirt at four sizes and two prices has a range, not a price. Availability is computed from
 * real stock — a page that says "out of stock" while its markup says `InStock` earns a manual
 * action, and rightly.
 */
export function productJsonLd(product: ProductDetail, storeName: string) {
  // getProductDetail already returns active variants only.
  const sellable = product.variants;
  const prices = sellable.map((variant) => variant.priceCents);
  /**
   * On hand, not availability-net-of-reservations.
   *
   * A unit held by someone's 15-minute checkout is still stock we have, and by the time a
   * crawler re-reads the page that hold has almost certainly expired one way or the other.
   * The buy box uses the stricter number; this is the one that will still be true in an hour.
   */
  const anyInStock = sellable.some((variant) => variant.stockQty > 0);

  const availability = anyInStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const url = absoluteUrl(`/products/${product.slug}`);

  const offers =
    sellable.length === 1 && prices[0] !== undefined
      ? {
          "@type": "Offer",
          url,
          priceCurrency: "PHP",
          price: pesos(prices[0]),
          availability,
          itemCondition: "https://schema.org/NewCondition",
          seller: { "@type": "Organization", name: storeName || SITE_NAME },
        }
      : {
          "@type": "AggregateOffer",
          url,
          priceCurrency: "PHP",
          lowPrice: pesos(Math.min(...prices)),
          highPrice: pesos(Math.max(...prices)),
          offerCount: sellable.length,
          availability,
          seller: { "@type": "Organization", name: storeName || SITE_NAME },
        };

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    sku: sellable[0]?.sku,
    url,
    /**
     * Absolute, always. A crawler fetches these from its own servers, where a relative path
     * resolves to nothing — and a Product with a broken image is dropped from rich results
     * rather than shown without one.
     */
    image:
      product.images.length > 0
        ? product.images.map((image) =>
            image.url.startsWith("http") ? image.url : absoluteUrl(image.url)
          )
        : undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    category: product.category?.name,
    offers,
    // Only when reviews exist. See the note at the top of this file.
    ...(product.ratingCount > 0 && product.ratingAverage !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.ratingAverage.toFixed(1),
            reviewCount: product.ratingCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(product.reviews.length > 0
      ? {
          review: product.reviews.slice(0, 5).map((review) => ({
            "@type": "Review",
            reviewRating: {
              "@type": "Rating",
              ratingValue: review.rating,
              bestRating: 5,
              worstRating: 1,
            },
            author: { "@type": "Person", name: review.authorName },
            datePublished: review.createdAt.toISOString().slice(0, 10),
            reviewBody: review.body ?? undefined,
          })),
        }
      : {}),
  };
}
