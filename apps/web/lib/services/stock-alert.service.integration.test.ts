import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { adjustStock } from "./inventory.service";
import {
  claimAlertsFor,
  countWaiting,
  subscribeToStock,
  unsubscribeFromStock,
} from "./stock-alert.service";

/**
 * The P4-07 acceptance criterion: back-in-stock notification fires on restock.
 *
 * "Fires" is tested at the seam where it is decided â€” `adjustStock` returning the people to
 * tell â€” rather than by watching the mailer, which is still a stub. What is proved here is
 * that the right recipients are claimed exactly once on the right event; the transport is
 * P3-06's problem and is recorded as such in docs/08.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let actorId = "";

async function wipe() {
  await db.stockSubscription.deleteMany();
  await db.notification.deleteMany();
  await db.stockReservation.deleteMany();
  await db.inventoryMovement.deleteMany();
  await db.auditLog.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

async function makeVariant(stockQty: number, productStatus = "active") {
  const product = await db.product.create({
    data: {
      name: unique("Barako"),
      slug: unique("barako").toLowerCase(),
      status: productStatus as never,
      description: "",
    },
  });

  return db.productVariant.create({
    data: {
      productId: product.id,
      sku: unique("SKU").toUpperCase(),
      name: "1kg",
      priceCents: 90_000,
      stockQty,
      isActive: true,
    },
  });
}

function restock(variantId: string, delta: number) {
  return db.$transaction((tx) =>
    adjustStock(tx, {
      variantId,
      delta,
      reason: "restock",
      note: "Delivery received",
      actorId,
    })
  );
}

describeIntegration("back-in-stock alerts", () => {
  beforeEach(async () => {
    await wipe();
    const admin = await db.user.create({
      data: { name: "Ramon", email: `${unique("a")}@example.test`, role: "admin" },
    });
    actorId = admin.id;
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("subscribing", () => {
    it("takes an address for something that is out of stock", async () => {
      const variant = await makeVariant(0);
      expect((await subscribeToStock(db, variant.id, "joel@example.test", null)).kind).toBe("ok");
      expect(await countWaiting(db, variant.id)).toBe(1);
    });

    it("refuses when the thing is already available", async () => {
      // A subscription that can never fire is a promise we silently fail to keep.
      const variant = await makeVariant(5);
      expect((await subscribeToStock(db, variant.id, "joel@example.test", null)).kind).toBe(
        "in_stock"
      );
    });

    it("takes an address when every unit is held by a live checkout", async () => {
      // stockQty says 1, but nobody else can buy it. Availability is the honest measure.
      const variant = await makeVariant(1);
      await db.stockReservation.create({
        data: {
          variantId: variant.id,
          quantity: 1,
          expiresAt: new Date(Date.now() + 900_000),
        },
      });

      expect((await subscribeToStock(db, variant.id, "joel@example.test", null)).kind).toBe("ok");
    });

    it("counts asking twice as once", async () => {
      const variant = await makeVariant(0);
      await subscribeToStock(db, variant.id, "joel@example.test", null);
      await subscribeToStock(db, variant.id, "JOEL@example.test", null);

      expect(await countWaiting(db, variant.id)).toBe(1);
    });

    it("lets someone unsubscribe", async () => {
      const variant = await makeVariant(0);
      await subscribeToStock(db, variant.id, "joel@example.test", null);
      await unsubscribeFromStock(db, variant.id, "joel@example.test");

      expect(await countWaiting(db, variant.id)).toBe(0);
    });
  });

  describe("firing on restock", () => {
    it("claims everyone waiting when stock crosses back above zero", async () => {
      const variant = await makeVariant(0);
      await subscribeToStock(db, variant.id, "a@example.test", null);
      await subscribeToStock(db, variant.id, "b@example.test", null);

      const result = await restock(variant.id, 5);
      if (result.kind !== "ok") throw new Error(result.kind);

      expect(result.alerts.map((alert) => alert.email).sort()).toEqual([
        "a@example.test",
        "b@example.test",
      ]);
      expect(await countWaiting(db, variant.id)).toBe(0);
    });

    it("does NOT fire on a top-up that never crossed zero", async () => {
      /**
       * The control for the crossing rule. A level check ("stock > 0 after the movement")
       * would fire here, emailing everyone again on the second delivery of the week.
       */
      const variant = await makeVariant(3);
      await db.stockSubscription.create({
        data: { variantId: variant.id, email: "a@example.test" },
      });

      const result = await restock(variant.id, 5);
      if (result.kind !== "ok") throw new Error(result.kind);

      expect(result.alerts).toHaveLength(0);
      expect(await countWaiting(db, variant.id)).toBe(1);
    });

    it("does not fire on a write-off", async () => {
      const variant = await makeVariant(5);
      await db.stockSubscription.create({
        data: { variantId: variant.id, email: "a@example.test" },
      });

      const result = await db.$transaction((tx) =>
        adjustStock(tx, {
          variantId: variant.id,
          delta: -5,
          reason: "damage",
          note: "Water damage",
          actorId,
        })
      );
      if (result.kind !== "ok") throw new Error(result.kind);

      expect(result.alerts).toHaveLength(0);
    });

    it("tells each person once, however many restocks follow", async () => {
      const variant = await makeVariant(0);
      await subscribeToStock(db, variant.id, "a@example.test", null);

      const first = await restock(variant.id, 2);
      if (first.kind !== "ok") throw new Error(first.kind);
      expect(first.alerts).toHaveLength(1);

      // Sold out again, then restocked again. They asked once; they hear once.
      await db.$transaction((tx) =>
        adjustStock(tx, {
          variantId: variant.id,
          delta: -2,
          reason: "adjustment",
          note: "Sold at the chapter meeting",
          actorId,
        })
      );
      const second = await restock(variant.id, 2);
      if (second.kind !== "ok") throw new Error(second.kind);

      expect(second.alerts).toHaveLength(0);
    });

    it("puts them back in the queue if they ask again", async () => {
      const variant = await makeVariant(0);
      await subscribeToStock(db, variant.id, "a@example.test", null);
      await restock(variant.id, 2);

      await db.$transaction((tx) =>
        adjustStock(tx, {
          variantId: variant.id,
          delta: -2,
          reason: "adjustment",
          note: "Sold out again",
          actorId,
        })
      );
      expect((await subscribeToStock(db, variant.id, "a@example.test", null)).kind).toBe("ok");

      const again = await restock(variant.id, 2);
      if (again.kind !== "ok") throw new Error(again.kind);
      expect(again.alerts).toHaveLength(1);
    });

    it("writes an in-app notification for subscribers who have accounts", async () => {
      const variant = await makeVariant(0);
      const customer = await db.user.create({
        data: { name: "Joel", email: `${unique("c")}@example.test`, role: "customer" },
      });

      await subscribeToStock(db, variant.id, "joel@example.test", customer.id);
      await subscribeToStock(db, variant.id, "guest@example.test", null);

      const result = await restock(variant.id, 4);
      if (result.kind !== "ok") throw new Error(result.kind);

      // Both get an email; only the one with an account gets a bell.
      expect(result.alerts).toHaveLength(2);
      const notifications = await db.notification.findMany({ where: { userId: customer.id } });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.type).toBe("back_in_stock");
    });

    it("stays quiet for a product that has been pulled from sale", async () => {
      // Driving traffic to something nobody can buy wastes the one message we get to send.
      const variant = await makeVariant(0, "draft");
      await db.stockSubscription.create({
        data: { variantId: variant.id, email: "a@example.test" },
      });

      const result = await restock(variant.id, 5);
      if (result.kind !== "ok") throw new Error(result.kind);

      expect(result.alerts).toHaveLength(0);
      // Still waiting, so they hear about it if the product is published again.
      expect(await countWaiting(db, variant.id)).toBe(1);
    });

    it("claims each subscriber once when two restocks land at the same moment", async () => {
      /**
       * Without the row lock in claimAlertsFor both transactions read the same waiting row,
       * both stamp it, and the customer who asked once is told twice. Each claim needs its own
       * transaction here â€” a lock taken outside one is released immediately.
       */
      const variant = await makeVariant(0);
      await subscribeToStock(db, variant.id, "a@example.test", null);

      const claim = () =>
        db
          .$transaction((tx) => claimAlertsFor(tx, variant.id), {
            timeout: 20_000,
            maxWait: 15_000,
          })
          .catch(() => [] as Awaited<ReturnType<typeof claimAlertsFor>>);

      const [first, second] = await Promise.all([claim(), claim()]);

      expect(first.length + second.length).toBe(1);
    });

    it("holds at three claims under ten simultaneous restocks", async () => {
      const variant = await makeVariant(0);
      for (const address of ["a", "b", "c"]) {
        await subscribeToStock(db, variant.id, `${address}@example.test`, null);
      }

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          db
            .$transaction((tx) => claimAlertsFor(tx, variant.id), {
              timeout: 20_000,
              maxWait: 15_000,
            })
            .catch(() => [] as Awaited<ReturnType<typeof claimAlertsFor>>)
        )
      );

      // Three subscribers, handed out three times in total however many claims ran.
      expect(results.flat()).toHaveLength(3);
    });

    it("claims nobody when the surrounding transaction rolls back", async () => {
      /**
       * The claim is inside the caller's transaction, so a failure later in the restock leaves
       * the subscription waiting rather than silently marked as told.
       *
       * The send is the other half of that ordering â€” it runs after the commit, so a bounced
       * email cannot undo a stock movement. The ledger is the truth about what is on the
       * shelf, and an email says nothing about what was counted.
       */
      const variant = await makeVariant(0);
      await subscribeToStock(db, variant.id, "a@example.test", null);

      await db
        .$transaction(async (tx) => {
          await adjustStock(tx, {
            variantId: variant.id,
            delta: 3,
            reason: "restock",
            note: "Delivery received",
            actorId,
          });
          throw new Error("something later in the transaction failed");
        })
        .catch(() => undefined);

      const after = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(after.stockQty).toBe(0);
      expect(await countWaiting(db, variant.id)).toBe(1);
    });
  });
});
