"use client";

import { useState } from "react";

import { BuyBox } from "@/components/shop/buy-box";
import { Rating } from "@/components/ui/rating";
import { Tabs } from "@/components/ui/tabs";
import type { DetailVariant, ProductDetail } from "@/lib/services/catalog.service";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

/**
 * Gallery and buy box.
 *
 * One client component owns both because selecting a variant has to move the gallery: a
 * variant with its own image should show it. Splitting them would mean lifting the selection
 * into a context for no gain.
 */
export function ProductDetailView({
  product,
  isMember,
}: {
  product: ProductDetail;
  isMember: boolean;
}) {
  const [activeImage, setActiveImage] = useState(0);

  /**
   * Points the gallery at the variant's image when there is one.
   *
   * Matching by alt text is a stopgap: variants have no image relation in the schema, so
   * until one exists this is the only link between them. Worth revisiting when the media
   * pipeline lands in P1-06 and variants can own images properly.
   */
  function onVariantChange(variant: DetailVariant) {
    const index = product.images.findIndex((image) =>
      image.alt?.toLowerCase().includes(variant.name.toLowerCase())
    );
    if (index >= 0) setActiveImage(index);
  }

  const image = product.images[activeImage];

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Gallery. Sticky on desktop so the buy box stays reachable while reading — docs/05. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="aspect-square w-full overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.url}
                alt={image.alt ?? product.name}
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center bg-page text-text-soft">
                <svg viewBox="0 0 48 48" className="size-14" fill="none" aria-hidden="true">
                  <rect
                    x="6"
                    y="10"
                    width="36"
                    height="28"
                    rx="3"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  />
                  <path
                    d="M6 30l9-8 7 6 6-5 14 11"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="sr-only-live">No image available</span>
              </div>
            )}
          </div>

          {product.images.length > 1 ? (
            <ul className="mt-3 flex gap-2 overflow-x-auto">
              {product.images.map((thumb, index) => (
                <li key={thumb.id}>
                  <button
                    type="button"
                    onClick={() => setActiveImage(index)}
                    aria-label={`Show image ${index + 1}`}
                    aria-current={index === activeImage}
                    className={cn(
                      "size-16 overflow-hidden rounded-[var(--radius-ctrl)] border-2 bg-surface",
                      index === activeImage ? "border-brand-600" : "border-border-subtle"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb.url} alt="" className="size-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            {product.brand ? <p className="text-sm text-text-muted">{product.brand}</p> : null}
            <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">
              {product.name}
            </h1>
            {product.ratingCount > 0 && product.ratingAverage !== null ? (
              <div className="mt-2">
                <Rating value={product.ratingAverage} count={product.ratingCount} />
              </div>
            ) : null}
          </div>

          <BuyBox
            variants={product.variants}
            isMember={isMember}
            onVariantChange={onVariantChange}
          />
        </div>
      </div>

      <div className="mt-12">
        <Tabs
          items={[
            {
              id: "description",
              label: "Description",
              content: (
                <p className="max-w-2xl whitespace-pre-line text-[15px] text-text-muted">
                  {product.description ?? "No description yet."}
                </p>
              ),
            },
            {
              id: "reviews",
              label: `Reviews${product.ratingCount > 0 ? ` (${product.ratingCount})` : ""}`,
              content:
                product.reviews.length === 0 ? (
                  <p className="text-[15px] text-text-muted">
                    No reviews yet. Only verified purchasers can leave one.
                  </p>
                ) : (
                  <ul className="flex max-w-2xl flex-col gap-6">
                    {product.reviews.map((review) => (
                      <li key={review.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Rating value={review.rating} />
                          {review.verifiedPurchase ? (
                            <span className="text-xs font-semibold text-success-text">
                              Verified purchase
                            </span>
                          ) : null}
                        </div>
                        {review.title ? <p className="mt-1 font-semibold">{review.title}</p> : null}
                        {review.body ? (
                          <p className="mt-1 text-[15px] text-text-muted">{review.body}</p>
                        ) : null}
                        <p className="mt-1 text-[13px] text-text-soft">
                          {review.authorName} · {formatDate(review.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ),
            },
          ]}
        />
      </div>
    </>
  );
}
