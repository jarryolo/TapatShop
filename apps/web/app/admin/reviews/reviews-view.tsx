"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Rating } from "@/components/ui/rating";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils/format";

export interface ReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  verifiedPurchase: boolean;
  productId: string;
  productName: string;
  productSlug: string;
  authorName: string;
  authorEmail: string;
}

const TONES: Record<string, BadgeTone> = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
};

export function ReviewsView({ rows, status }: { rows: ReviewRow[]; status: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function moderate(id: string, decision: "approved" | "rejected") {
    setPending(id);
    const response = await fetch(`/api/v1/admin/reviews/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setPending(null);

    if (!response.ok) {
      toast("Could not record that decision.", "error");
      return;
    }

    toast(decision === "approved" ? "Review published." : "Review rejected.", "success");
    router.refresh();
  }

  const tabs = [
    { key: "pending", label: "Waiting" },
    { key: "approved", label: "Published" },
    { key: "rejected", label: "Rejected" },
    { key: "", label: "All" },
  ];

  return (
    <>
      <nav aria-label="Filter reviews" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key || "all"}
            href={tab.key ? `/admin/reviews?status=${tab.key}` : "/admin/reviews"}
            aria-current={status === tab.key ? "page" : undefined}
            className={
              status === tab.key
                ? "rounded-[var(--radius-ctrl)] bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
                : "rounded-[var(--radius-ctrl)] bg-surface-sunken px-3 py-1.5 text-sm hover:bg-surface"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing here"
            body={
              status === "pending"
                ? "No reviews are waiting. Nothing a customer wrote is on the shop until it has been read."
                : "No reviews match that filter."
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((review) => (
            <Card key={review.id}>
              <CardHeader>
                <CardTitle>
                  <Link
                    href={`/products/${review.productSlug}`}
                    className="hover:text-brand-600 hover:underline"
                  >
                    {review.productName}
                  </Link>
                </CardTitle>
                <Badge tone={TONES[review.status] ?? "neutral"}>{review.status}</Badge>
              </CardHeader>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Rating value={review.rating} />
                <span className="text-sm font-semibold">{review.authorName}</span>
                <span className="text-[13px] text-text-muted">{review.authorEmail}</span>
                {review.verifiedPurchase ? (
                  <Badge tone="success">Verified purchase</Badge>
                ) : (
                  // Should not happen — the service refuses non-purchasers — so if one ever
                  // shows up here it is worth an admin noticing rather than blending in.
                  <Badge tone="danger">No purchase on record</Badge>
                )}
                <span className="ml-auto text-[13px] text-text-muted">
                  {formatDateTime(review.createdAt)}
                </span>
              </div>

              {review.title ? <p className="mt-3 font-semibold">{review.title}</p> : null}
              {review.body ? (
                <p className="mt-1 whitespace-pre-line text-sm">{review.body}</p>
              ) : (
                <p className="mt-1 text-sm text-text-muted">No written review, just a rating.</p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {review.status !== "approved" ? (
                  <Button
                    size="sm"
                    loading={pending === review.id}
                    onClick={() => moderate(review.id, "approved")}
                  >
                    Publish
                  </Button>
                ) : null}
                {review.status !== "rejected" ? (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={pending === review.id}
                    onClick={() => moderate(review.id, "rejected")}
                  >
                    {review.status === "approved" ? "Unpublish" : "Reject"}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
