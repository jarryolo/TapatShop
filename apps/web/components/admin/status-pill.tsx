import { Badge, type BadgeTone } from "@/components/ui/badge";

/**
 * The three order status axes from docs/03, each with its own colour mapping.
 *
 * They are deliberately separate components rather than one with a `type` prop. A real order
 * is "confirmed and paid but not yet shipped", and three independent pills are the only
 * honest way to show that.
 */

const ORDER_TONES = {
  pending: "neutral",
  confirmed: "brand",
  completed: "success",
  cancelled: "danger",
} as const satisfies Record<string, BadgeTone>;

const PAYMENT_TONES = {
  unpaid: "neutral",
  awaiting_payment: "warning",
  paid: "success",
  partially_refunded: "warning",
  refunded: "neutral",
  failed: "danger",
} as const satisfies Record<string, BadgeTone>;

const FULFILLMENT_TONES = {
  unfulfilled: "neutral",
  packed: "brand",
  shipped: "brand",
  delivered: "success",
  returned: "warning",
} as const satisfies Record<string, BadgeTone>;

export type OrderStatus = keyof typeof ORDER_TONES;
export type PaymentStatus = keyof typeof PAYMENT_TONES;
export type FulfillmentStatus = keyof typeof FULFILLMENT_TONES;

/** `awaiting_payment` reads as "Awaiting payment". Sentence case, per docs/CLAUDE.md. */
function label(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONES[status]}>{label(status)}</Badge>;
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONES[status]}>{label(status)}</Badge>;
}

export function FulfillmentStatusPill({ status }: { status: FulfillmentStatus }) {
  return <Badge tone={FULFILLMENT_TONES[status]}>{label(status)}</Badge>;
}
