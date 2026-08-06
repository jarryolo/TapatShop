import type {
  FulfillmentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from "@tapatshop/db";

import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

/**
 * Admin-side order reads: the list, its filters, the detail view, and the CSV export.
 *
 * Separate from order.service, which owns the state machine. This file only reads.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export interface OrderFilters {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  /** Order number, customer name, or email. */
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function orderWhere(filters: OrderFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.fulfillmentStatus) where.fulfillmentStatus = filters.fulfillmentStatus;

  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    // `to` is inclusive of the whole day: a range ending "6 Aug" must include orders placed
    // at 6 Aug 23:59, which a bare `lte: 2026-08-06T00:00:00` would silently exclude.
    if (filters.to) {
      const end = new Date(filters.to);
      end.setUTCHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  if (filters.q?.trim()) {
    const term = filters.q.trim();
    where.OR = [
      { orderNo: { contains: term } },
      { customerName: { contains: term } },
      { customerEmail: { contains: term } },
      { trackingNumber: { contains: term } },
    ];
  }

  return where;
}

export async function listOrdersForAdmin(tx: Db, filters: OrderFilters) {
  const limit = Math.min(Math.max(1, filters.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const page = Math.max(1, filters.page ?? 1);
  const where = orderWhere(filters);

  const [total, orders] = await Promise.all([
    tx.order.count({ where }),
    tx.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        customerEmail: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        totalCents: true,
        refundedCents: true,
        trackingNumber: true,
        createdAt: true,
        // One extra query for the whole page, not one per order.
        _count: { select: { items: true } },
      },
    }),
  ]);

  return {
    data: orders,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/**
 * Everything the detail page needs.
 *
 * Includes internal events, unlike the customer timeline — this view is staff-only and the
 * notes are the point.
 */
export async function getOrderForAdmin(tx: Db, id: string) {
  return tx.order.findUnique({
    where: { id },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" } },
      user: { select: { id: true, name: true, email: true, memberNo: true } },
    },
  });
}

export async function getOrderByNoForAdmin(tx: Db, orderNo: string) {
  const order = await tx.order.findUnique({ where: { orderNo }, select: { id: true } });
  return order ? getOrderForAdmin(tx, order.id) : null;
}

/**
 * CSV for the admin export.
 *
 * Every field is quoted and internal quotes doubled. Excel treats a leading `=`, `+`, `-` or
 * `@` as a formula, so those are prefixed with a single quote — an order from a customer
 * called "=cmd|..." must not execute anything when the shop owner opens the file.
 */
export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';

  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(toCsvCell).join(",");
  const body = rows.map((row) => columns.map((column) => toCsvCell(row[column])).join(","));
  // CRLF, which is what Excel expects.
  return [header, ...body].join("\r\n");
}

export async function exportOrdersCsv(tx: Db, filters: OrderFilters): Promise<string> {
  const orders = await tx.order.findMany({
    where: orderWhere(filters),
    orderBy: { createdAt: "desc" },
    take: MAX_LIMIT * 10,
    select: {
      orderNo: true,
      createdAt: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      subtotalCents: true,
      shippingCents: true,
      discountCents: true,
      totalCents: true,
      refundedCents: true,
      couponCode: true,
      carrier: true,
      trackingNumber: true,
      shippingAddress: true,
    },
  });

  const rows = orders.map((order) => {
    const address = (order.shippingAddress ?? {}) as Record<string, string>;

    return {
      "Order number": order.orderNo,
      Placed: formatDate(order.createdAt),
      Customer: order.customerName,
      Email: order.customerEmail,
      Phone: order.customerPhone,
      Status: order.status,
      Payment: order.paymentStatus,
      Fulfilment: order.fulfillmentStatus,
      // Peso strings for the humans who open this, with the raw centavos alongside so the
      // file can still be reconciled without re-parsing currency.
      Subtotal: formatPeso(order.subtotalCents),
      Shipping: formatPeso(order.shippingCents),
      Discount: formatPeso(order.discountCents),
      Total: formatPeso(order.totalCents),
      "Total (centavos)": order.totalCents,
      Refunded: formatPeso(order.refundedCents),
      Coupon: order.couponCode ?? "",
      Carrier: order.carrier ?? "",
      Tracking: order.trackingNumber ?? "",
      Address: [address.street, address.barangay, address.city, address.province]
        .filter(Boolean)
        .join(", "),
    };
  });

  const columns = [
    "Order number",
    "Placed",
    "Customer",
    "Email",
    "Phone",
    "Status",
    "Payment",
    "Fulfilment",
    "Subtotal",
    "Shipping",
    "Discount",
    "Total",
    "Total (centavos)",
    "Refunded",
    "Coupon",
    "Carrier",
    "Tracking",
    "Address",
  ];

  return toCsv(rows, columns);
}

/** Counts for the list page's filter chips, in one grouped query rather than one per status. */
export async function orderCounts(tx: Db) {
  const [byStatus, byFulfillment] = await Promise.all([
    tx.order.groupBy({ by: ["status"], _count: true }),
    tx.order.groupBy({ by: ["fulfillmentStatus"], _count: true }),
  ]);

  return {
    status: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
    fulfillment: Object.fromEntries(
      byFulfillment.map((row) => [row.fulfillmentStatus, row._count])
    ),
  };
}

export const adminOrders = {
  list: (filters: OrderFilters) => listOrdersForAdmin(db, filters),
  get: (id: string) => getOrderForAdmin(db, id),
  getByNo: (orderNo: string) => getOrderByNoForAdmin(db, orderNo),
  exportCsv: (filters: OrderFilters) => exportOrdersCsv(db, filters),
  counts: () => orderCounts(db),
};
