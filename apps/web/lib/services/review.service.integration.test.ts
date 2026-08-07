import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  approvedReviews,
  listReviewsForAdmin,
  moderateReview,
  ratingSummary,
  reviewEligibility,
  submitReview,
} from "./review.service";

/**
 * The P4-07 acceptance criterion: only verified purchasers can review, and reviews require
 * moderation before display.
 *
 * The second half is the one that goes wrong quietly. A review that is stored correctly but
 * displayed anyway is indistinguishable from a working system until someone posts something
 * the store would not have published — so the display path is tested directly, not inferred
 * from the status column.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let admin = { id: "", ip: "203.0.113.8" };

async function wipe() {
  await db.review.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.auditLog.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

async function makeProduct() {
  const product = await db.product.create({
    data: {
      name: unique("Polo"),
      slug: unique("polo").toLowerCase(),
      status: "active",
      description: "",
    },
  });

  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: unique("SKU").toUpperCase(),
      name: "Default",
      priceCents: 100_000,
      stockQty: 10,
      isActive: true,
    },
  });

  return { product, variant };
}

async function makeCustomer(verified = true) {
  return db.user.create({
    data: {
      name: "Joel Santos",
      email: `${unique("c")}@example.test`,
      role: "customer",
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
}

async function buy(userId: string, variantId: string, paymentStatus = "paid") {
  const order = await db.order.create({
    data: {
      orderNo: unique("TS-R").toUpperCase(),
      userId,
      paymentStatus: paymentStatus as never,
      subtotalCents: 100_000,
      totalCents: 100_000,
      paidAt: paymentStatus === "paid" ? new Date() : null,
      shippingAddress: {},
      customerName: "Joel Santos",
      customerEmail: "joel@example.test",
      customerPhone: "09171234567",
    },
  });

  await db.orderItem.create({
    data: {
      orderId: order.id,
      variantId,
      productName: "Polo",
      variantName: "Default",
      sku: unique("S").toUpperCase(),
      unitPriceCents: 100_000,
      quantity: 1,
      lineTotalCents: 100_000,
    },
  });

  return order;
}

describeIntegration("review.service", () => {
  beforeEach(async () => {
    await wipe();
    const user = await db.user.create({
      data: { name: "Ramon", email: `${unique("a")}@example.test`, role: "admin" },
    });
    admin = { id: user.id, ip: "203.0.113.8" };
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("only verified purchasers can review", () => {
    it("accepts someone who bought and paid", async () => {
      const { product, variant } = await makeProduct();
      const customer = await makeCustomer();
      await buy(customer.id, variant.id);

      const result = await submitReview(db, {
        productId: product.id,
        userId: customer.id,
        rating: 5,
        body: "Sturdy stitching.",
      });

      expect(result.kind).toBe("ok");
    });

    it("refuses someone who never bought it", async () => {
      const { product } = await makeProduct();
      const customer = await makeCustomer();

      const result = await submitReview(db, {
        productId: product.id,
        userId: customer.id,
        rating: 5,
      });

      expect(result.kind).toBe("not_purchased");
      expect(await db.review.count()).toBe(0);
    });

    it("refuses someone whose order was never paid", async () => {
      // An unpaid order is a basket, not a purchase.
      const { product, variant } = await makeProduct();
      const customer = await makeCustomer();
      await buy(customer.id, variant.id, "awaiting_payment");

      expect(
        (await submitReview(db, { productId: product.id, userId: customer.id, rating: 4 })).kind
      ).toBe("not_purchased");
    });

    it("refuses someone who bought a different product", async () => {
      const bought = await makeProduct();
      const other = await makeProduct();
      const customer = await makeCustomer();
      await buy(customer.id, bought.variant.id);

      expect(
        (await submitReview(db, { productId: other.product.id, userId: customer.id, rating: 5 }))
          .kind
      ).toBe("not_purchased");
    });

    it("refuses an unverified email", async () => {
      // docs/07: verification is required before leaving a review, though not before checkout.
      const { product, variant } = await makeProduct();
      const customer = await makeCustomer(false);
      await buy(customer.id, variant.id);

      expect(
        (await submitReview(db, { productId: product.id, userId: customer.id, rating: 5 })).kind
      ).toBe("email_unverified");
    });

    it("allows one review per product per person", async () => {
      const { product, variant } = await makeProduct();
      const customer = await makeCustomer();
      await buy(customer.id, variant.id);

      expect(
        (await submitReview(db, { productId: product.id, userId: customer.id, rating: 5 })).kind
      ).toBe("ok");
      expect(
        (await submitReview(db, { productId: product.id, userId: customer.id, rating: 1 })).kind
      ).toBe("already_reviewed");
    });

    it("rejects a rating outside one to five", async () => {
      const { product, variant } = await makeProduct();
      const customer = await makeCustomer();
      await buy(customer.id, variant.id);

      for (const rating of [0, 6, -1, 4.5]) {
        expect(
          (await submitReview(db, { productId: product.id, userId: customer.id, rating })).kind
        ).toBe("invalid_rating");
      }
    });

    it("stamps the order it was bought on, so the badge means something", async () => {
      const { product, variant } = await makeProduct();
      const customer = await makeCustomer();
      const order = await buy(customer.id, variant.id);

      await submitReview(db, { productId: product.id, userId: customer.id, rating: 5 });

      const review = await db.review.findFirstOrThrow();
      // Taken from the eligibility check, never from the request.
      expect(review.orderId).toBe(order.id);
    });

    it("reports why before anything is submitted", async () => {
      const { product } = await makeProduct();
      const customer = await makeCustomer();

      expect((await reviewEligibility(db, customer.id, product.id)).kind).toBe("not_purchased");
    });
  });

  describe("moderation before display", () => {
    async function pendingReview() {
      const { product, variant } = await makeProduct();
      const customer = await makeCustomer();
      await buy(customer.id, variant.id);
      const result = await submitReview(db, {
        productId: product.id,
        userId: customer.id,
        rating: 5,
        body: "Would recommend.",
      });
      if (result.kind !== "ok") throw new Error("expected ok");
      return { productId: product.id, reviewId: result.id };
    }

    it("files every new review as pending", async () => {
      const { reviewId } = await pendingReview();
      const review = await db.review.findUniqueOrThrow({ where: { id: reviewId } });
      expect(review.status).toBe("pending");
    });

    it("does not display a pending review", async () => {
      // The criterion, tested on the display path rather than on the column.
      const { productId } = await pendingReview();
      expect(await approvedReviews(db, productId)).toHaveLength(0);
    });

    it("displays it once approved", async () => {
      const { productId, reviewId } = await pendingReview();
      await moderateReview(db, reviewId, "approved", admin);

      expect(await approvedReviews(db, productId)).toHaveLength(1);
    });

    it("does not display a rejected review", async () => {
      const { productId, reviewId } = await pendingReview();
      await moderateReview(db, reviewId, "rejected", admin);

      expect(await approvedReviews(db, productId)).toHaveLength(0);
    });

    it("hides it again if approval is withdrawn", async () => {
      const { productId, reviewId } = await pendingReview();
      await moderateReview(db, reviewId, "approved", admin);
      await moderateReview(db, reviewId, "rejected", admin);

      expect(await approvedReviews(db, productId)).toHaveLength(0);
    });

    it("audits who moderated it", async () => {
      const { reviewId } = await pendingReview();
      await moderateReview(db, reviewId, "approved", admin);

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "review.approve" } });
      expect(entry.actorId).toBe(admin.id);
      expect(entry.before).toMatchObject({ status: "pending" });
      expect(entry.after).toMatchObject({ status: "approved" });
    });

    it("reports a review that does not exist", async () => {
      expect((await moderateReview(db, "nope", "approved", admin)).kind).toBe("not_found");
    });

    it("shows pending reviews to the admin, who has to see them to act", async () => {
      await pendingReview();
      expect(await listReviewsForAdmin(db, "pending")).toHaveLength(1);
    });
  });

  describe("the rating summary", () => {
    async function reviewWith(productId: string, variantId: string, rating: number) {
      const customer = await makeCustomer();
      await buy(customer.id, variantId);
      const result = await submitReview(db, { productId, userId: customer.id, rating });
      if (result.kind !== "ok") throw new Error(result.kind);
      await moderateReview(db, result.id, "approved", admin);
    }

    it("averages approved reviews only", async () => {
      const { product, variant } = await makeProduct();
      await reviewWith(product.id, variant.id, 5);
      await reviewWith(product.id, variant.id, 4);

      // A third, left pending — it must not move the average shown to customers.
      const customer = await makeCustomer();
      await buy(customer.id, variant.id);
      await submitReview(db, { productId: product.id, userId: customer.id, rating: 1 });

      const summary = await ratingSummary(db, product.id);
      expect(summary.total).toBe(2);
      expect(summary.average).toBe(4.5);
    });

    it("returns no average at all when nothing is approved", async () => {
      // 0.0 out of 5 reads as a terrible product rather than a new one.
      const { product } = await makeProduct();
      const summary = await ratingSummary(db, product.id);

      expect(summary.total).toBe(0);
      expect(summary.average).toBeNull();
    });

    it("counts each star separately", async () => {
      const { product, variant } = await makeProduct();
      await reviewWith(product.id, variant.id, 5);
      await reviewWith(product.id, variant.id, 5);
      await reviewWith(product.id, variant.id, 3);

      // counts[0] is one star.
      expect((await ratingSummary(db, product.id)).counts).toEqual([0, 0, 1, 0, 2]);
    });
  });
});
