import type { Metadata } from "next";
import Link from "next/link";

import { ProductCard, ProductGrid } from "@/components/shop/product-card";
import { ButtonLink } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { homeShelves, listCategories, memberDiscountPercent } from "@/lib/services/catalog.service";
import { readSetting } from "@/lib/services/settings.service";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { organizationJsonLd, websiteJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Honest goods from the brotherhood",
    description:
      "Member-made goods, branded merchandise, books and food products. Clear prices, no fake urgency.",
    path: "/",
  }),
  // The home page is the one title that should not carry the "— TapatShop" suffix twice.
  title: { absolute: "TapatShop — honest goods from the brotherhood" },
};

export const revalidate = 300;

export default async function HomePage() {
  const [session, percent] = await Promise.all([auth(), memberDiscountPercent()]);
  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);

  const [{ featured, newArrivals, hero }, categories] = await Promise.all([
    homeShelves(isMember ? percent : 0),
    listCategories(),
  ]);

  const tiles = categories.filter((c) => !c.parentId && c._count.products > 0);
  const storeName = String(await readSetting(db, "store_name", "TapatShop"));

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
      {/* Identity and the search box, declared once on the home page rather than site-wide. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(organizationJsonLd(storeName))}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(websiteJsonLd(storeName))}
      />
      {/* Hero. No countdown, no "hurry" — docs/01 and docs/05 rule those out explicitly. */}
      <section className="rounded-[var(--radius-card)] bg-brand-600 px-6 py-12 text-white md:px-12 md:py-16">
        <h1 className="max-w-2xl text-3xl font-semibold md:text-[44px] md:leading-[1.1]">
          {hero?.title ?? "Straight dealing, every order"}
        </h1>
        <p className="mt-3 max-w-xl text-brand-50">
          {hero?.subtitle ?? "Clear prices. No countdown timers."}
        </p>
        <ButtonLink
          href={hero?.linkUrl ?? "/products"}
          variant="secondary"
          size="lg"
          className="mt-6"
        >
          Browse the catalog
        </ButtonLink>
      </section>

      {tiles.length > 0 ? (
        <section className="mt-12 md:mt-16">
          <h2 className="text-xl font-semibold md:text-2xl">Shop by category</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-4">
            {tiles.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.slug}`}
                  className="flex h-full flex-col justify-between rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow duration-150 hover:shadow-[var(--shadow-raised)] md:p-6"
                >
                  <span className="text-[17px] font-semibold md:text-lg">{category.name}</span>
                  <span className="mt-2 text-[13px] text-text-muted">
                    {category._count.products}{" "}
                    {category._count.products === 1 ? "product" : "products"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {featured.length > 0 ? (
        <section className="mt-12 md:mt-16">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold md:text-2xl">Featured</h2>
            <Link href="/products" className="text-sm font-semibold text-brand-600 hover:underline">
              See all
            </Link>
          </div>
          <ProductGrid>
            {featured.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} showMemberPrice={isMember} />
            ))}
          </ProductGrid>
        </section>
      ) : null}

      {newArrivals.length > 0 ? (
        <section className="mt-12 md:mt-16">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold md:text-2xl">New arrivals</h2>
            <Link
              href="/products?sort=newest"
              className="text-sm font-semibold text-brand-600 hover:underline"
            >
              See all
            </Link>
          </div>
          <ProductGrid>
            {newArrivals.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} showMemberPrice={isMember} />
            ))}
          </ProductGrid>
        </section>
      ) : null}

      {/* Trust strip — docs/05. Statements of fact, not persuasion. */}
      <section className="mt-12 grid gap-4 rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-card)] md:mt-16 md:grid-cols-3">
        {[
          {
            title: "Secure payment",
            body: "GCash, Maya, cards and online banking through PayMongo.",
          },
          {
            title: "Nationwide shipping",
            body: "Metro Manila in 1 to 3 days. Nationwide in up to 9.",
          },
          { title: "30-day returns", body: "Unused items can be returned within 30 days." },
        ].map((item) => (
          <div key={item.title}>
            <p className="font-semibold">{item.title}</p>
            <p className="mt-1 text-sm text-text-muted">{item.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
