import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  IllegalTransitionError,
  addEvent,
  addTracking,
  customerTimeline,
  trackOrder,
  transitionOrder,
} from "./order.service";

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.auditLog.deleteMany();
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.user.deleteMany();
}

async function makeOrder(overrides: Record<string, unknown> = {}) {
  return db.order.create({
    data: {
      orderNo: unique("TS-ORD").toUpperCase(),
      status: "confirmed",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      subtotalCents: 100_000,
      shippingCents: 8_000,
      totalCents: 108_000,
      shippingAddress: { city: "Quezon City" },
      customerName: "Joel Santos",
      customerEmail: "joel@example.test",
      customerPhone: "09171234567",
      guestEmail: "joel@example.test",
      ...overrides,
    },
  });
}

describeIntegration("order.service", () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("transitions", () => {
    it("moves along a legal path and records an event", async () => {
      const order = await makeOrder();
      const after = await transitionOrder(db, order.id, { fulfillmentStatus: "packed" });

      expect(after.fulfillmentStatus).toBe("packed");
      const events = await db.orderEvent.findMany({ where: { orderId: order.id } });
      expect(events).toHaveLength(1);
    });

    it("throws on an illegal move and changes nothing", async () => {
      const order = await makeOrder({ fulfillmentStatus: "delivered" });

      await expect(
        transitionOrder(db, order.id, { fulfillmentStatus: "packed" })
      ).rejects.toBeInstanceOf(IllegalTransitionError);

      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.fulfillmentStatus).toBe("delivered");
      expect(await db.orderEvent.count({ where: { orderId: order.id } })).toBe(0);
    });

    it("stamps paidAt when payment lands", async () => {
      const order = await makeOrder({ paymentStatus: "awaiting_payment", paidAt: null });
      const after = await transitionOrder(db, order.id, { paymentStatus: "paid" });

      expect(after.paidAt).toBeInstanceOf(Date);
    });

    it("requires a reason to cancel", async () => {
      const order = await makeOrder({ status: "pending" });

      await expect(transitionOrder(db, order.id, { status: "cancelled" })).rejects.toThrow(
        /reason/i
      );

      const after = await transitionOrder(db, order.id, {
        status: "cancelled",
        cancelReason: "Customer changed their mind",
      });
      expect(after.cancelledAt).toBeInstanceOf(Date);
      expect(after.cancelReason).toBe("Customer changed their mind");
    });

    it("writes an audit row for an admin-initiated move", async () => {
      const admin = await db.user.create({
        data: { name: "Ramon", email: `${unique("a")}@example.test`, role: "admin" },
      });
      const order = await makeOrder();

      await transitionOrder(db, order.id, { fulfillmentStatus: "packed", actorId: admin.id });

      const entry = await db.auditLog.findFirstOrThrow({ where: { entityId: order.id } });
      expect(entry.action).toBe("order.transition");
      expect(entry.before).toMatchObject({ fulfillmentStatus: "unfulfilled" });
      expect(entry.after).toMatchObject({ fulfillmentStatus: "packed" });
    });

    it("does nothing when every axis already has the requested value", async () => {
      const order = await makeOrder();
      await transitionOrder(db, order.id, { status: "confirmed" });

      expect(await db.orderEvent.count({ where: { orderId: order.id } })).toBe(0);
    });
  });

  describe("tracking", () => {
    it("ships the order and queues the email exactly once", async () => {
      const order = await makeOrder({ fulfillmentStatus: "packed" });

      const after = await addTracking(db, order.id, {
        carrier: "J&T Express",
        trackingNumber: "JNT-PH-1",
      });

      expect(after.fulfillmentStatus).toBe("shipped");
      expect(after.shippedAt).toBeInstanceOf(Date);

      // Correcting the number later must not re-notify — P4-01 asks for exactly once, and a
      // customer told three times their order shipped starts marking mail as spam.
      const corrected = await addTracking(db, order.id, {
        carrier: "J&T Express",
        trackingNumber: "JNT-PH-2",
      });

      expect(corrected.trackingNumber).toBe("JNT-PH-2");
      const shippedEvents = await db.orderEvent.count({
        where: { orderId: order.id, type: "shipped" },
      });
      expect(shippedEvents).toBe(1);
    });
  });

  describe("the customer timeline", () => {
    it("shows public events and hides internal notes", async () => {
      const order = await makeOrder();
      await addEvent(db, order.id, { type: "status_changed", message: "Packed.", isPublic: true });
      await addEvent(db, order.id, {
        type: "note_added",
        message: "Customer sounded annoyed on the phone.",
        isPublic: false,
      });

      const timeline = await customerTimeline(db, order.id);

      expect(timeline).toHaveLength(1);
      expect(timeline[0]?.message).toBe("Packed.");
      expect(JSON.stringify(timeline)).not.toContain("annoyed");
    });
  });

  describe("guest tracking", () => {
    it("finds an order with the right number and email", async () => {
      const order = await makeOrder();
      const result = await trackOrder(db, order.orderNo, "joel@example.test");

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.order.orderNo).toBe(order.orderNo);
    });

    it("is case-insensitive about the email", async () => {
      const order = await makeOrder();
      expect((await trackOrder(db, order.orderNo, "JOEL@Example.TEST")).kind).toBe("ok");
    });

    it("refuses the right number with the wrong email", async () => {
      const order = await makeOrder();
      expect((await trackOrder(db, order.orderNo, "someone@else.test")).kind).toBe("not_found");
    });

    it("gives the same answer for a wrong email as for a nonexistent order", async () => {
      // Otherwise the endpoint tells an attacker which order numbers are real.
      const order = await makeOrder();
      const wrongEmail = await trackOrder(db, order.orderNo, "someone@else.test");
      const noSuchOrder = await trackOrder(db, "TS-2026-999999", "joel@example.test");

      expect(wrongEmail).toEqual(noSuchOrder);
    });

    it("returns only public events", async () => {
      const order = await makeOrder();
      await addEvent(db, order.id, { type: "status_changed", message: "Packed.", isPublic: true });
      await addEvent(db, order.id, { type: "note_added", message: "Internal.", isPublic: false });

      const result = await trackOrder(db, order.orderNo, "joel@example.test");
      if (result.kind !== "ok") throw new Error("expected ok");

      expect(result.order.events).toHaveLength(1);
      expect(JSON.stringify(result.order.events)).not.toContain("Internal");
    });
  });
});
