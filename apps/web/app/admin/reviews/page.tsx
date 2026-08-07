import type { Metadata } from "next";

import { StatCard } from "@/components/admin/stat-card";
import { db } from "@/lib/db";
import { listReviewsForAdmin } from "@/lib/services/review.service";

import { ReviewsView, type ReviewRow } from "./reviews-view";

export const metadata: Metadata = { title: "Reviews — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const status = (params.status ?? "pending") as "pending" | "approved" | "rejected" | "";

  const [reviews, waiting] = await Promise.all([
    listReviewsForAdmin(db, status || undefined),
    db.review.count({ where: { status: "pending" } }),
  ]);

  const rows: ReviewRow[] = reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    status: review.status,
    createdAt: review.createdAt.toISOString(),
    // Stamped by the service from the order it was bought on, never from the request.
    verifiedPurchase: review.orderId !== null,
    productId: review.product.id,
    productName: review.product.name,
    productSlug: review.product.slug,
    authorName: review.user.name,
    authorEmail: review.user.email,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Reviews</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Nothing a customer writes appears on the shop until someone here has read it. Only people
          who bought the product can leave one.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Waiting to be read"
          value={String(waiting)}
          tone={waiting > 0 ? "attention" : "default"}
        />
        <StatCard label="Showing" value={String(rows.length)} hint={status || "all statuses"} />
      </div>

      <ReviewsView rows={rows} status={status} />
    </div>
  );
}
