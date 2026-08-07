import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductCard, ProductGrid } from "@/components/shop/product-card";
import { ProductDetailView } from "@/components/shop/product-detail-view";
import type { ReviewGate } from "@/components/shop/review-form";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getProductDetail,
  memberDiscountPercent,
  relatedProducts,
} from "@/lib/services/catalog.service";
import { reviewEligibility } from "@/lib/services/review.service";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductDetail(slug);
  if (!product) return { title: "Not found — TapatShop" };

  return {
    title: `${product.name} — TapatShop`,
    description: product.description?.slice(0, 160) ?? undefined,
    openGraph: {
      title: product.name,
      description: product.description?.slice(0, 160) ?? undefined,
      images: product.images[0] ? [{ url: product.images[0].url }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const session = await auth();
  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);
  const percent = isMember ? await memberDiscountPercent() : 0;

  const product = await getProductDetail(slug, percent);
  if (!product) notFound();

  const related = await relatedProducts(product.id, product.category?.slug ?? null, percent);

  /**
   * Whether this person may review, worked out server-side.
   *
   * The client is told which rule applies so it can say so, but it is never the thing that
   * decides — the same check runs again in the service when the review is submitted.
   */
  const gate: ReviewGate = session?.user?.id
    ? (await reviewEligibility(db, session.user.id, product.id)).kind
    : "signed_out";

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-10">
      <Breadcrumb
        className="mb-6"
        items={[
          { label: "Home", href: "/" },
          ...(product.category
            ? [{ label: product.category.name, href: `/c/${product.category.slug}` }]
            : [{ label: "All products", href: "/products" }]),
          { label: product.name },
        ]}
      />

      <ProductDetailView
        product={product}
        isMember={isMember}
        reviewGate={gate}
        signedInEmail={session?.user?.email ?? null}
      />

      {related.length > 0 ? (
        <section className="mt-16">
          <h2 className="mb-4 text-xl font-semibold md:text-2xl">You might also like</h2>
          <ProductGrid>
            {related.map((item) => (
              <ProductCard key={item.id} product={item} showMemberPrice={isMember} />
            ))}
          </ProductGrid>
        </section>
      ) : null}
    </div>
  );
}
