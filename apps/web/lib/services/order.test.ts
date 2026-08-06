import { describe, expect, it } from "vitest";

import {
  FULFILLMENT_TRANSITIONS,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  allowedNext,
  assertTransition,
  canTransition,
  IllegalTransitionError,
} from "./order.service";

/**
 * The state machine from docs/03, as a specification.
 *
 * These are pure map lookups, so they need no database — which is the point of keeping the
 * legal transitions as an explicit map rather than scattering `if` statements through the
 * admin routes.
 */

describe("order status", () => {
  it("follows pending → confirmed → completed", () => {
    expect(canTransition("status", "pending", "confirmed")).toBe(true);
    expect(canTransition("status", "confirmed", "completed")).toBe(true);
  });

  it("allows cancelling from pending or confirmed", () => {
    expect(canTransition("status", "pending", "cancelled")).toBe(true);
    expect(canTransition("status", "confirmed", "cancelled")).toBe(true);
  });

  it("refuses to skip confirmed", () => {
    expect(canTransition("status", "pending", "completed")).toBe(false);
  });

  it("refuses to move backwards", () => {
    expect(canTransition("status", "confirmed", "pending")).toBe(false);
    expect(canTransition("status", "completed", "confirmed")).toBe(false);
  });

  it("treats completed and cancelled as terminal", () => {
    // Undoing a completed order is a refund, not a status edit.
    expect(ORDER_TRANSITIONS.completed).toEqual([]);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
  });

  it("refuses to resurrect a cancelled order", () => {
    expect(canTransition("status", "cancelled", "confirmed")).toBe(false);
    expect(canTransition("status", "cancelled", "pending")).toBe(false);
  });
});

describe("payment status", () => {
  it("follows unpaid → awaiting_payment → paid", () => {
    expect(canTransition("paymentStatus", "unpaid", "awaiting_payment")).toBe(true);
    expect(canTransition("paymentStatus", "awaiting_payment", "paid")).toBe(true);
  });

  it("allows a paid order to be refunded, partly or fully", () => {
    expect(canTransition("paymentStatus", "paid", "partially_refunded")).toBe(true);
    expect(canTransition("paymentStatus", "paid", "refunded")).toBe(true);
    expect(canTransition("paymentStatus", "partially_refunded", "refunded")).toBe(true);
  });

  it("refuses to un-refund", () => {
    // Money that has gone back cannot be taken again by editing a status.
    expect(canTransition("paymentStatus", "refunded", "paid")).toBe(false);
    expect(canTransition("paymentStatus", "partially_refunded", "paid")).toBe(false);
  });

  it("refuses to mark an unpaid order paid without going through awaiting_payment", () => {
    expect(canTransition("paymentStatus", "unpaid", "paid")).toBe(false);
  });

  it("treats a failed payment as terminal — a retry is a new order", () => {
    expect(PAYMENT_TRANSITIONS.failed).toEqual([]);
    expect(canTransition("paymentStatus", "failed", "paid")).toBe(false);
  });
});

describe("fulfillment status", () => {
  it("follows unfulfilled → packed → shipped → delivered", () => {
    expect(canTransition("fulfillmentStatus", "unfulfilled", "packed")).toBe(true);
    expect(canTransition("fulfillmentStatus", "packed", "shipped")).toBe(true);
    expect(canTransition("fulfillmentStatus", "shipped", "delivered")).toBe(true);
  });

  it("allows unpacking, because packing the wrong box happens", () => {
    expect(canTransition("fulfillmentStatus", "packed", "unfulfilled")).toBe(true);
  });

  it("refuses to unship — a parcel with a courier cannot be recalled by an edit", () => {
    expect(canTransition("fulfillmentStatus", "shipped", "packed")).toBe(false);
    expect(canTransition("fulfillmentStatus", "delivered", "shipped")).toBe(false);
  });

  it("allows a return from shipped or delivered", () => {
    expect(canTransition("fulfillmentStatus", "shipped", "returned")).toBe(true);
    expect(canTransition("fulfillmentStatus", "delivered", "returned")).toBe(true);
  });

  it("refuses to skip straight to shipped", () => {
    expect(canTransition("fulfillmentStatus", "unfulfilled", "shipped")).toBe(false);
  });

  it("treats returned as terminal", () => {
    expect(FULFILLMENT_TRANSITIONS.returned).toEqual([]);
  });
});

describe("transition rules in general", () => {
  it("treats a move to the current value as a legal no-op", () => {
    // The admin UI submits the whole form, so unchanged axes must not throw.
    expect(canTransition("status", "confirmed", "confirmed")).toBe(true);
    expect(canTransition("fulfillmentStatus", "returned", "returned")).toBe(true);
  });

  it("throws with the axis and both values, so the error is actionable", () => {
    expect(() => assertTransition("status", "completed", "pending")).toThrow(
      IllegalTransitionError
    );

    try {
      assertTransition("fulfillmentStatus", "delivered", "packed");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect((error as IllegalTransitionError).axis).toBe("fulfillmentStatus");
      expect((error as IllegalTransitionError).from).toBe("delivered");
      expect((error as Error).message).toContain("delivered");
      expect((error as Error).message).toContain("packed");
    }
  });

  it("rejects an unknown state rather than allowing it through", () => {
    expect(canTransition("status", "nonsense", "confirmed")).toBe(false);
    expect(canTransition("status", "pending", "nonsense")).toBe(false);
  });

  it("offers the admin UI exactly what the map allows", () => {
    // docs/03: the UI only offers legal transitions, and it reads them from here rather
    // than hardcoding a list that can drift.
    expect(allowedNext("status", "pending")).toEqual(["confirmed", "cancelled"]);
    expect(allowedNext("fulfillmentStatus", "shipped")).toEqual(["delivered", "returned"]);
    expect(allowedNext("paymentStatus", "refunded")).toEqual([]);
    expect(allowedNext("status", "nonsense")).toEqual([]);
  });

  it("never lists a transition it would then refuse", () => {
    // Guards against the two halves drifting apart.
    for (const axis of ["status", "paymentStatus", "fulfillmentStatus"] as const) {
      const map =
        axis === "status"
          ? ORDER_TRANSITIONS
          : axis === "paymentStatus"
            ? PAYMENT_TRANSITIONS
            : FULFILLMENT_TRANSITIONS;

      for (const from of Object.keys(map)) {
        for (const to of allowedNext(axis, from)) {
          expect(canTransition(axis, from, to), `${axis}: ${from} → ${to}`).toBe(true);
        }
      }
    }
  });

  it("only ever names states that exist", () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      expect(Object.keys(ORDER_TRANSITIONS)).toContain(from);
      for (const to of targets) expect(Object.keys(ORDER_TRANSITIONS)).toContain(to);
    }
    for (const [from, targets] of Object.entries(PAYMENT_TRANSITIONS)) {
      expect(Object.keys(PAYMENT_TRANSITIONS)).toContain(from);
      for (const to of targets) expect(Object.keys(PAYMENT_TRANSITIONS)).toContain(to);
    }
    for (const [from, targets] of Object.entries(FULFILLMENT_TRANSITIONS)) {
      expect(Object.keys(FULFILLMENT_TRANSITIONS)).toContain(from);
      for (const to of targets) expect(Object.keys(FULFILLMENT_TRANSITIONS)).toContain(to);
    }
  });
});
