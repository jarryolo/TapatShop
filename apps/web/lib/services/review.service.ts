import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";

import { log } from "./audit.service";

/**
 * Reviews. Two rules from docs/01 and docs/08 govern everything here:
 *
 *   1. only someone who actually bought the product may review it
 *   2. nothing is displayed until an admin has approved it
 *
 * Both are enforced in this service rather than in the route, so there is one place to read
 * and no way to reach the database around them.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** Payment states that mean the customer really received the goods. */
const PAID = ["paid", "partially_refunded", "refunded"] as const;

export type ReviewEligibility =
  | { kind: "ok"; orderId: string }
  | { kind: "not_purchased" }
  | { kind: "email_unverified" }
  | { kind: "already_reviewed" };

/**
 * May this person review this product, and against which order?
 *
 * Checks the order items rather than a flag on the user, because the order item is the record
 * that the purchase happened. docs/07 additionally requires a verified email before leaving a
 * review — an unverified address is an unowned one, and a review is published under a name.
 */
export async function reviewEligibility(
  tx: Db,
  userId: string,
  productId: string
): Promise<ReviewEligibility> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (!user?.emailVerifiedAt) return { kind: "email_unverified" };

  const existing = await tx.review.findUnique({
    where: { productId_userId: { productId, userId } },
    select: { id: true },
  });
  if (existing) return { kind: "already_reviewed" };

  const item = await tx.orderItem.findFirst({
    where: {
      variant: { productId },
      order: { userId, paymentStatus: { in: [...PAID] } },
    },
    orderBy: { order: { paidAt: "asc" } },
    select: { orderId: true },
  });

  if (!item) return { kind: "not_purchased" };

  return { kind: "ok", orderId: item.orderId };
}

export interface ReviewInput {
  productId: string;
  userId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
}

export type SubmitReviewResult =
  | { kind: "ok"; id: string }
  | { kind: "invalid_rating" }
  | Exclude<ReviewEligibility, { kind: "ok" }>;

/**
 * Files a review. Always `pending` — there is no path here that publishes one.
 *
 * `orderId` is stamped from the eligibility check rather than taken from the request, so the
 * "verified purchase" badge on the storefront means what it says.
 */
export async function submitReview(tx: Db, input: ReviewInput): Promise<SubmitReviewResult> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { kind: "invalid_rating" };
  }

  const eligibility = await reviewEligibility(tx, input.userId, input.productId);
  if (eligibility.kind !== "ok") return eligibility;

  const review = await tx.review.create({
    data: {
      productId: input.productId,
      userId: input.userId,
      orderId: eligibility.orderId,
      rating: input.rating,
      title: input.title?.trim() || null,
      body: input.body?.trim() || null,
      // Not a default worth trusting to the schema: this is the moderation rule itself.
      status: "pending",
    },
    select: { id: true },
  });

  return { kind: "ok", id: review.id };
}

// ─────────────────────────────  display  ─────────────────────────────

/**
 * Approved reviews only. This is the function the storefront calls.
 *
 * Separate from the admin list rather than a filter parameter, on purpose — a parameter that
 * defaults to "all" is one forgotten argument away from publishing unmoderated text.
 */
export function approvedReviews(tx: Db, productId: string, take = 20) {
  return tx.review.findMany({
    where: { productId, status: "approved" },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      createdAt: true,
      orderId: true,
      user: { select: { name: true } },
    },
  });
}

/** The rating summary shown on a product: average and a count per star. */
export async function ratingSummary(tx: Db, productId: string) {
  const rows = await tx.review.groupBy({
    by: ["rating"],
    where: { productId, status: "approved" },
    _count: true,
  });

  const counts = [1, 2, 3, 4, 5].map(
    (star) => rows.find((row) => row.rating === star)?._count ?? 0
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  const weighted = counts.reduce((sum, count, index) => sum + count * (index + 1), 0);

  return {
    total,
    // One decimal, and only when there is something to average. 0.0 out of 5 on a product
    // nobody has reviewed reads as a terrible product rather than a new one.
    average: total === 0 ? null : Math.round((weighted / total) * 10) / 10,
    counts,
  };
}

// ─────────────────────────────  moderation  ─────────────────────────────

export function listReviewsForAdmin(tx: Db, status?: "pending" | "approved" | "rejected") {
  return tx.review.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      product: { select: { id: true, name: true, slug: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

export type ModerateResult = { kind: "ok" } | { kind: "not_found" };

export async function moderateReview(
  tx: Db,
  id: string,
  decision: "approved" | "rejected",
  actor: { id: string; ip?: string | null; userAgent?: string | null }
): Promise<ModerateResult> {
  const before = await tx.review.findUnique({ where: { id } });
  if (!before) return { kind: "not_found" };

  await tx.review.update({ where: { id }, data: { status: decision } });

  await log(tx, {
    actorId: actor.id,
    action: decision === "approved" ? "review.approve" : "review.reject",
    entity: "Review",
    entityId: id,
    before: { status: before.status },
    after: { status: decision },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok" };
}

export const reviewService = {
  eligibility: (userId: string, productId: string) => reviewEligibility(db, userId, productId),
  submit: (input: ReviewInput) => db.$transaction((tx) => submitReview(tx, input)),
  approved: (productId: string, take?: number) => approvedReviews(db, productId, take),
  summary: (productId: string) => ratingSummary(db, productId),
  listForAdmin: (status?: "pending" | "approved" | "rejected") => listReviewsForAdmin(db, status),
  moderate: (
    id: string,
    decision: "approved" | "rejected",
    actor: Parameters<typeof moderateReview>[3]
  ) => db.$transaction((tx) => moderateReview(tx, id, decision, actor)),
};
