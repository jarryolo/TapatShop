import type { FulfillmentStatus, OrderStatus, PaymentStatus } from "@/components/admin/status-pill";

/**
 * TEMPORARY display data for the dashboard and orders table.
 *
 * The role fixture is gone — P1-05 wired the real session, and the admin shell now reads it.
 * These rows remain because the admin *queries* belong to P4-01 and P4-06; they mirror
 * packages/db/seed.ts so the pages look the same once they read live data.
 *
 * Nothing outside app/admin may import this.
 */

export interface AdminOrderRow extends Record<string, unknown> {
  orderNo: string;
  customer: string;
  placedAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  totalCents: number;
  itemCount: number;
}

export const ORDERS: AdminOrderRow[] = [
  {
    orderNo: "TS-2026-000101",
    customer: "Ana Reyes",
    placedAt: "2026-08-06T04:00:00.000Z",
    status: "pending",
    paymentStatus: "awaiting_payment",
    fulfillmentStatus: "unfulfilled",
    totalCents: 97000,
    itemCount: 2,
  },
  {
    orderNo: "TS-2026-000102",
    customer: "Joel Santos",
    placedAt: "2026-08-04T04:00:00.000Z",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    totalCents: 298800,
    itemCount: 4,
  },
  {
    orderNo: "TS-2026-000103",
    customer: "Maricel Dizon",
    placedAt: "2026-08-01T04:00:00.000Z",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "packed",
    totalCents: 194800,
    itemCount: 3,
  },
  {
    orderNo: "TS-2026-000104",
    customer: "Joel Santos",
    placedAt: "2026-07-28T04:00:00.000Z",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "shipped",
    totalCents: 228500,
    itemCount: 1,
  },
  {
    orderNo: "TS-2026-000105",
    customer: "Maricel Dizon",
    placedAt: "2026-07-16T04:00:00.000Z",
    status: "completed",
    paymentStatus: "paid",
    fulfillmentStatus: "delivered",
    totalCents: 176000,
    itemCount: 5,
  },
  {
    orderNo: "TS-2026-000106",
    customer: "Maricel Dizon",
    placedAt: "2026-07-03T04:00:00.000Z",
    status: "completed",
    paymentStatus: "refunded",
    fulfillmentStatus: "returned",
    totalCents: 150000,
    itemCount: 1,
  },
  {
    orderNo: "TS-2026-000107",
    customer: "Paolo Cruz",
    placedAt: "2026-07-25T04:00:00.000Z",
    status: "cancelled",
    paymentStatus: "failed",
    fulfillmentStatus: "unfulfilled",
    totalCents: 48000,
    itemCount: 1,
  },
];

export interface LowStockRow extends Record<string, unknown> {
  sku: string;
  product: string;
  variant: string;
  stockQty: number;
  threshold: number;
}

export const LOW_STOCK: LowStockRow[] = [
  {
    sku: "APP-WIND-XL-BLK",
    product: "Chapter windbreaker",
    variant: "Extra large / Black",
    stockQty: 2,
    threshold: 5,
  },
  {
    sku: "FOD-COF-1K-WB",
    product: "Barako coffee beans",
    variant: "1kg / Whole bean",
    stockQty: 3,
    threshold: 5,
  },
  {
    sku: "APP-POLO-XL-NVY",
    product: "Brotherhood polo shirt",
    variant: "Extra large / Navy",
    stockQty: 4,
    threshold: 5,
  },
];

export const DASHBOARD = {
  salesTodayCents: 298800,
  ordersToday: 1,
  awaitingAction: 2,
  lowStockCount: LOW_STOCK.length,
};
