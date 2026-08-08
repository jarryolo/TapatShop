import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";

import { customerOrderSelect } from "./order.service";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * A customer's own order history.
 *
 * `docs/01` lists "order list and order detail with a status timeline and tracking number"
 * under Account, and the header has linked to `/account` for signed-in users since the shop
 * layout was written — but no page existed, so clicking your own name 404'd and the only way
 * to see an order was the guest tracking form, which asks for an order number you would only
 * have from the confirmation email.
 *
 * ## Which orders belong to someone
 *
 * Two ways, and the second needs care.
 *
 * By `userId`, set at checkout when the buyer was signed in. Unambiguous.
 *
 * By email, for orders placed as a guest before registering — without this, someone who
 * checked out as a guest and then made an account sees an empty history and reasonably
 * concludes their order is lost. **Only when the account's email is verified.** An order
 * carries a full delivery address and phone number, so matching an unverified address would
 * hand those to anyone who signs up claiming someone else's email. That is the whole reason
 * `emailVerifiedAt` is consulted here rather than trusting `user.email` alone.
 */

/** The scope of "my orders", as a reusable where clause so list and detail cannot disagree. */
function ownedBy(userId: string, email: string | null): Prisma.OrderWhereInput {
  const clauses: Prisma.OrderWhereInput[] = [{ userId }];

  // Only a verified address claims guest orders. See the note above — this is a privacy
  // boundary, not a convenience.
  if (email) clauses.push({ userId: null, guestEmail: email });

  return { OR: clauses };
}

/** The verified email for this account, or null if it has not been confirmed. */
async function verifiedEmail(tx: Db, userId: string): Promise<string | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true },
  });

  return user?.emailVerifiedAt ? user.email.toLowerCase() : null;
}

export interface OrderListItem {
  orderNo: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalCents: number;
  placedAt: Date | null;
  createdAt: Date;
  itemCount: number;
  firstItemName: string | null;
  firstItemImage: string | null;
}

/**
 * The order list. Newest first, and it deliberately reads from the snapshot on `order_items`
 * rather than joining live products — CLAUDE.md invariant 4. A product renamed or deleted
 * since must not change what this says was bought.
 */
export async function listOrders(tx: Db, userId: string, take = 50): Promise<OrderListItem[]> {
  const email = await verifiedEmail(tx, userId);

  const orders = await tx.order.findMany({
    where: ownedBy(userId, email),
    // placedAt is null until payment confirms, so it cannot be the only sort key or a pending
    // order jumps to the bottom of the list the buyer is looking at right now.
    orderBy: [{ createdAt: "desc" }],
    take,
    select: {
      orderNo: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      totalCents: true,
      placedAt: true,
      createdAt: true,
      items: {
        select: { productName: true, imageUrl: true, quantity: true },
      },
    },
  });

  return orders.map((order) => ({
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    totalCents: order.totalCents,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    firstItemName: order.items[0]?.productName ?? null,
    firstItemImage: order.items[0]?.imageUrl ?? null,
  }));
}

/**
 * One order, scoped to its owner.
 *
 * Someone else's order number returns null rather than a 403, so the page cannot be used to
 * discover which order numbers exist — the same reasoning as guest tracking, where a wrong
 * email gives "not found" rather than "wrong email".
 */
export async function orderFor(tx: Db, userId: string, orderNo: string) {
  const email = await verifiedEmail(tx, userId);

  return tx.order.findFirst({
    where: { AND: [{ orderNo: orderNo.trim().toUpperCase() }, ownedBy(userId, email)] },
    select: customerOrderSelect,
  });
}

export const accountService = {
  listOrders: (userId: string, take?: number) => listOrders(db, userId, take),
  orderFor: (userId: string, orderNo: string) => orderFor(db, userId, orderNo),
};
