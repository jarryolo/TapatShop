import type {
  FulfillmentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from "@tapatshop/db";

import { db } from "@/lib/db";

import { log } from "./audit.service";
import { sendEmail } from "./email.service";

/**
 * The order state machine. See docs/03-data-model.md.
 *
 * Three independent axes, deliberately not collapsed into one status field: a real order is
 * routinely "confirmed and paid but not yet shipped", and a single enum makes that
 * combinatorially awful.
 *
 * The maps below are the whole specification. Any transition not listed throws — docs/03 is
 * explicit that arbitrary status writes from the admin UI are not allowed, and an explicit
 * map is the only way to keep that true as the admin grows more buttons.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  // Terminal. A completed order that needs undoing is a refund, not a status edit.
  completed: [],
  cancelled: [],
};

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: ["awaiting_payment", "failed"],
  awaiting_payment: ["paid", "failed"],
  paid: ["partially_refunded", "refunded"],
  // A partial refund can become a full one, never the reverse.
  partially_refunded: ["refunded"],
  refunded: [],
  // A failed payment is retried by starting a new checkout, which makes a new order.
  failed: [],
};

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  unfulfilled: ["packed"],
  packed: ["shipped", "unfulfilled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  returned: [],
};

export type Axis = "status" | "paymentStatus" | "fulfillmentStatus";

export class IllegalTransitionError extends Error {
  constructor(
    readonly axis: Axis,
    readonly from: string,
    readonly to: string
  ) {
    super(`Cannot move ${axis} from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/** Whether a move is legal. Moving to the current value is always allowed and is a no-op. */
export function canTransition(axis: Axis, from: string, to: string): boolean {
  if (from === to) return true;

  const map =
    axis === "status"
      ? ORDER_TRANSITIONS
      : axis === "paymentStatus"
        ? PAYMENT_TRANSITIONS
        : FULFILLMENT_TRANSITIONS;

  const allowed = (map as Record<string, readonly string[]>)[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** What the admin UI may offer from here. The UI renders this, never a hardcoded list. */
export function allowedNext(axis: Axis, from: string): readonly string[] {
  const map =
    axis === "status"
      ? ORDER_TRANSITIONS
      : axis === "paymentStatus"
        ? PAYMENT_TRANSITIONS
        : FULFILLMENT_TRANSITIONS;

  return (map as Record<string, readonly string[]>)[from] ?? [];
}

export function assertTransition(axis: Axis, from: string, to: string): void {
  if (!canTransition(axis, from, to)) throw new IllegalTransitionError(axis, from, to);
}

// ─────────────────────────────  events  ─────────────────────────────

export interface OrderEventInput {
  type: string;
  message: string;
  /** Public events appear on the customer's timeline. Internal notes never do. */
  isPublic: boolean;
  actorId?: string | null;
}

export async function addEvent(
  tx: Db,
  orderId: string,
  event: OrderEventInput,
  at: Date = new Date()
): Promise<void> {
  await tx.orderEvent.create({
    data: {
      orderId,
      type: event.type,
      message: event.message,
      isPublic: event.isPublic,
      actorId: event.actorId ?? null,
      createdAt: at,
    },
  });
}

// ─────────────────────────────  transitions  ─────────────────────────────

export interface TransitionInput {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  /** Required when cancelling — an order cancelled for no recorded reason is a support ticket. */
  cancelReason?: string;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Moves an order along one or more axes, refusing anything the maps do not allow.
 *
 * Every accepted move writes an OrderEvent, and an admin-initiated one also writes an
 * AuditLog — invariant I8.
 */
export async function transitionOrder(
  tx: Db,
  orderId: string,
  input: TransitionInput,
  now: Date = new Date()
) {
  const before = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

  if (input.status) assertTransition("status", before.status, input.status);
  if (input.paymentStatus) {
    assertTransition("paymentStatus", before.paymentStatus, input.paymentStatus);
  }
  if (input.fulfillmentStatus) {
    assertTransition("fulfillmentStatus", before.fulfillmentStatus, input.fulfillmentStatus);
  }

  if (input.status === "cancelled" && !input.cancelReason?.trim()) {
    throw new Error("Cancelling an order requires a reason");
  }

  const data: Prisma.OrderUpdateInput = {};
  const events: OrderEventInput[] = [];

  if (input.status && input.status !== before.status) {
    data.status = input.status;
    if (input.status === "cancelled") {
      data.cancelledAt = now;
      data.cancelReason = input.cancelReason?.trim();
      events.push({
        type: "status_changed",
        message: `Cancelled. ${input.cancelReason?.trim()}`,
        isPublic: true,
        actorId: input.actorId,
      });
    } else {
      events.push({
        type: "status_changed",
        message: `Order ${input.status}.`,
        isPublic: true,
        actorId: input.actorId,
      });
    }
  }

  if (input.paymentStatus && input.paymentStatus !== before.paymentStatus) {
    data.paymentStatus = input.paymentStatus;
    if (input.paymentStatus === "paid") data.paidAt = now;
    events.push({
      type: input.paymentStatus === "paid" ? "payment_received" : "payment_changed",
      message: `Payment ${input.paymentStatus.replace(/_/g, " ")}.`,
      isPublic: true,
      actorId: input.actorId,
    });
  }

  if (input.fulfillmentStatus && input.fulfillmentStatus !== before.fulfillmentStatus) {
    data.fulfillmentStatus = input.fulfillmentStatus;
    if (input.fulfillmentStatus === "shipped") data.shippedAt = now;
    if (input.fulfillmentStatus === "delivered") data.deliveredAt = now;
    events.push({
      type: "status_changed",
      message: `${input.fulfillmentStatus.charAt(0).toUpperCase()}${input.fulfillmentStatus.slice(1)}.`,
      isPublic: true,
      actorId: input.actorId,
    });
  }

  if (Object.keys(data).length === 0) return before;

  const after = await tx.order.update({ where: { id: orderId }, data });

  for (const event of events) await addEvent(tx, orderId, event, now);

  if (input.actorId) {
    await log(tx, {
      actorId: input.actorId,
      action: "order.transition",
      entity: "Order",
      entityId: orderId,
      before: {
        status: before.status,
        paymentStatus: before.paymentStatus,
        fulfillmentStatus: before.fulfillmentStatus,
      },
      after: {
        status: after.status,
        paymentStatus: after.paymentStatus,
        fulfillmentStatus: after.fulfillmentStatus,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  return after;
}

export interface TrackingInput {
  carrier: string;
  trackingNumber: string;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Records a tracking number and moves the order to shipped.
 *
 * The shipped email is queued exactly once: if the order is already shipped, the tracking
 * number is corrected without re-notifying. P4-01 asks for that explicitly, and a customer
 * receiving "your order has shipped" three times because someone fixed a typo is the kind of
 * thing that gets a store marked as spam.
 */
export async function addTracking(
  tx: Db,
  orderId: string,
  input: TrackingInput,
  now: Date = new Date()
) {
  const before = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const alreadyShipped = before.fulfillmentStatus === "shipped" || before.shippedAt !== null;

  if (!alreadyShipped) {
    assertTransition("fulfillmentStatus", before.fulfillmentStatus, "shipped");
  }

  const after = await tx.order.update({
    where: { id: orderId },
    data: {
      carrier: input.carrier.trim(),
      trackingNumber: input.trackingNumber.trim(),
      ...(alreadyShipped ? {} : { fulfillmentStatus: "shipped", shippedAt: now }),
    },
  });

  await addEvent(
    tx,
    orderId,
    {
      type: alreadyShipped ? "note_added" : "shipped",
      message: alreadyShipped
        ? `Tracking updated to ${after.trackingNumber} (${after.carrier}).`
        : `Shipped via ${after.carrier}, tracking ${after.trackingNumber}.`,
      isPublic: true,
      actorId: input.actorId,
    },
    now
  );

  if (!alreadyShipped) {
    await sendEmail({
      to: after.customerEmail,
      template: "order-shipped",
      data: {
        name: after.customerName,
        orderNo: after.orderNo,
        carrier: after.carrier ?? "",
        trackingNumber: after.trackingNumber ?? "",
      },
    });
  }

  return after;
}

// ─────────────────────────────  reads  ─────────────────────────────

/**
 * The customer-facing view of an order.
 *
 * Only public events. Internal notes — "customer sounded annoyed on the phone", "item
 * inspected on return" — exist on the same table and must never leak into this.
 */
export async function customerTimeline(tx: Db, orderId: string) {
  return tx.orderEvent.findMany({
    where: { orderId, isPublic: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, message: true, createdAt: true },
  });
}

export type TrackResult =
  { kind: "ok"; order: Awaited<ReturnType<typeof loadTrackedOrder>> } | { kind: "not_found" };

async function loadTrackedOrder(tx: Db, orderNo: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { orderNo },
    select: {
      orderNo: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      subtotalCents: true,
      shippingCents: true,
      discountCents: true,
      totalCents: true,
      carrier: true,
      trackingNumber: true,
      placedAt: true,
      shippedAt: true,
      deliveredAt: true,
      customerName: true,
      shippingAddress: true,
      items: {
        select: {
          id: true,
          productName: true,
          variantName: true,
          sku: true,
          imageUrl: true,
          unitPriceCents: true,
          quantity: true,
          lineTotalCents: true,
        },
      },
      events: {
        where: { isPublic: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, message: true, createdAt: true },
      },
    },
  });

  return order;
}

/**
 * Guest order lookup: order number plus the email on the order — docs/07.
 *
 * Both must match. The order number alone is guessable enough to matter, and this endpoint
 * returns a full delivery address. The comparison is case-insensitive on the email because
 * people capitalise inconsistently, and a mismatch returns the same "not found" as a
 * nonexistent order so the endpoint cannot be used to test whether an order number exists.
 */
export async function trackOrder(tx: Db, orderNo: string, email: string): Promise<TrackResult> {
  const normalisedEmail = email.trim().toLowerCase();

  const match = await tx.order.findUnique({
    where: { orderNo: orderNo.trim().toUpperCase() },
    select: { customerEmail: true, guestEmail: true },
  });

  if (!match) return { kind: "not_found" };

  const matches =
    match.customerEmail.toLowerCase() === normalisedEmail ||
    (match.guestEmail ?? "").toLowerCase() === normalisedEmail;

  if (!matches) return { kind: "not_found" };

  return { kind: "ok", order: await loadTrackedOrder(tx, orderNo.trim().toUpperCase()) };
}

export const orderService = {
  transition: (orderId: string, input: TransitionInput) =>
    db.$transaction((tx) => transitionOrder(tx, orderId, input)),
  addTracking: (orderId: string, input: TrackingInput) =>
    db.$transaction((tx) => addTracking(tx, orderId, input)),
  timeline: (orderId: string) => customerTimeline(db, orderId),
  track: (orderNo: string, email: string) => trackOrder(db, orderNo, email),
  allowedNext,
  canTransition,
};
