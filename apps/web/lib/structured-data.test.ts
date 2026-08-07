import { describe, expect, it } from "vitest";

import type { ProductDetail } from "@/lib/services/catalog.service";
import { listingCanonical } from "@/lib/seo";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/structured-data";

/**
 * The two SEO mistakes that are silent: structured data that claims something the page does
 * not, and canonicals that let one set of products compete with itself under a dozen URLs.
 *
 * Neither shows up in a browser. Both are caught here.
 */

function makeProduct(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "prod_1",
    name: "Barako coffee beans",
    slug: "barako-coffee-beans",
    brand: "Amadeo",
    description: "Dark roast from Cavite.",
    memberOnly: false,
    category: { name: "Food", slug: "food" },
    images: [{ id: "img_1", url: "/media/barako.jpg", alt: "A bag of beans" }],
    variants: [
      {
        id: "var_1",
        sku: "BARAKO-1KG",
        name: "1kg",
        priceCents: 90_000,
        compareAtPriceCents: null,
        memberPriceCents: 81_000,
        stockQty: 12,
        lowStockThreshold: 5,
        weightGrams: 1000,
        optionValues: null,
      },
    ],
    reviews: [],
    ratingAverage: null,
    ratingCount: 0,
    ...overrides,
  } as ProductDetail;
}

describe("productJsonLd", () => {
  it("advertises the regular price, never the member price", () => {
    // Member pricing needs a verified membership. Quoting it in search results would put a
    // number in front of people who cannot get it.
    const data = productJsonLd(makeProduct(), "TapatShop") as unknown as Record<string, unknown>;
    const offers = data.offers as Record<string, string>;

    expect(offers.price).toBe("900.00");
    expect(JSON.stringify(data)).not.toContain("810.00");
  });

  it("omits aggregateRating entirely when nothing has been reviewed", () => {
    // "0 out of 5" and "no rating" are different claims, and the first one is a lie.
    const data = productJsonLd(makeProduct(), "TapatShop") as Record<string, unknown>;
    expect(data.aggregateRating).toBeUndefined();
    expect(data.review).toBeUndefined();
  });

  it("includes aggregateRating once there are approved reviews", () => {
    const data = productJsonLd(
      makeProduct({ ratingAverage: 4.5, ratingCount: 8 }),
      "TapatShop"
    ) as unknown as Record<string, unknown>;
    const rating = data.aggregateRating as Record<string, unknown>;

    expect(rating.ratingValue).toBe("4.5");
    expect(rating.reviewCount).toBe(8);
  });

  it("says OutOfStock when every variant is empty", () => {
    // Markup that says InStock over a page saying "out of stock" earns a manual action.
    const product = makeProduct();
    product.variants[0]!.stockQty = 0;

    const data = productJsonLd(product, "TapatShop") as unknown as Record<string, unknown>;
    const offers = data.offers as Record<string, string>;

    expect(offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("is InStock while any one variant has stock", () => {
    const product = makeProduct();
    product.variants = [
      { ...product.variants[0]!, id: "a", stockQty: 0 },
      { ...product.variants[0]!, id: "b", stockQty: 3, priceCents: 95_000 },
    ];

    const data = productJsonLd(product, "TapatShop") as unknown as Record<string, unknown>;
    const offers = data.offers as Record<string, string>;

    expect(offers.availability).toBe("https://schema.org/InStock");
  });

  it("uses an AggregateOffer with a real range when variants differ in price", () => {
    const product = makeProduct();
    product.variants = [
      { ...product.variants[0]!, id: "a", priceCents: 50_000 },
      { ...product.variants[0]!, id: "b", priceCents: 90_000 },
    ];

    const data = productJsonLd(product, "TapatShop") as unknown as Record<string, unknown>;
    const offers = data.offers as Record<string, unknown>;

    expect(offers["@type"]).toBe("AggregateOffer");
    expect(offers.lowPrice).toBe("500.00");
    expect(offers.highPrice).toBe("900.00");
    expect(offers.offerCount).toBe(2);
  });

  it("makes image URLs absolute", () => {
    // A crawler fetches these from its own servers, where a relative path resolves to nothing.
    const data = productJsonLd(makeProduct(), "TapatShop") as unknown as Record<string, unknown>;
    const images = data.image as string[];

    expect(images[0]).toMatch(/^https?:\/\//);
    expect(images[0]).toContain("/media/barako.jpg");
  });

  it("leaves an already-absolute image alone", () => {
    const product = makeProduct({
      images: [{ id: "i", url: "https://cdn.example.test/x.jpg", alt: null }],
    });

    const data = productJsonLd(product, "TapatShop") as unknown as Record<string, unknown>;
    expect((data.image as string[])[0]).toBe("https://cdn.example.test/x.jpg");
  });

  it("prices in pesos, not centavos", () => {
    // The whole codebase is centavos; schema.org is decimal. This is the one boundary.
    const data = productJsonLd(makeProduct(), "TapatShop") as unknown as Record<string, unknown>;
    expect((data.offers as Record<string, string>).price).not.toBe("90000");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers positions from one and makes items absolute", () => {
    const data = breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Food", path: "/c/food" },
    ]) as unknown as Record<string, unknown>;

    const items = data.itemListElement as Record<string, unknown>[];
    expect(items[0]?.position).toBe(1);
    expect(items[1]?.position).toBe(2);
    expect(String(items[1]?.item)).toMatch(/^https?:\/\/.*\/c\/food$/);
  });
});

describe("listingCanonical", () => {
  it("drops filters and sort, which only rearrange the same products", () => {
    expect(listingCanonical("/products", { sort: "price_asc", minPrice: "100" })).toMatch(
      /\/products$/
    );
  });

  it("keeps the page number, because page two holds different products", () => {
    expect(listingCanonical("/products", { page: "3" })).toMatch(/\/products\?page=3$/);
  });

  it("treats page one as the bare URL", () => {
    // /products and /products?page=1 are the same page; only one of them should be canonical.
    expect(listingCanonical("/products", { page: "1" })).toMatch(/\/products$/);
  });

  it("drops a search term", () => {
    expect(listingCanonical("/products", { q: "coffee" })).toMatch(/\/products$/);
  });
});
