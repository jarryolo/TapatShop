import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";

import { log } from "./audit.service";
import { sendEmail } from "./email.service";

/**
 * Data Privacy Act erasure — RA 10173, and docs/01's compliance list.
 *
 * The central decision, and the one worth arguing with before changing:
 *
 *   **Erasure anonymises the person. It does not delete their orders.**
 *
 * BIR requires the invoice trail, and a shop that can erase its own sales records has a worse
 * problem than a privacy one. So the personal data goes — name, email, phone, addresses, saved
 * lists — and the financial rows stay with the personal fields scrubbed. What survives is
 * money, dates and order numbers, which identify a transaction rather than a human.
 *
 * The customer is told exactly this before they confirm, on the request screen. A promise of
 * total deletion that quietly keeps the orders would be the worst of both.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** What survives an erasure, in the words the customer is shown. Kept here so the page and the
 *  service cannot drift apart. */
export const ERASURE_TERMS = {
  removed: [
    "Your name, email address and phone number",
    "Your saved delivery addresses",
    "Your saved items and any back-in-stock alerts",
    "Your reviews",
    "Your password and any linked Google sign-in",
  ],
  kept: [
    "Your past orders — amounts, dates and order numbers",
    "The invoice records the BIR requires us to keep",
  ],
  keptWhy:
    "Philippine tax rules require us to keep sales records. Those rows stay, but your name, email, phone and delivery address are removed from them.",
} as const;

export type RequestResult =
  { kind: "ok"; id: string } | { kind: "already_pending" } | { kind: "not_found" };

/** Files a request. One open request at a time — asking twice is still one ask. */
export async function requestDeletion(
  tx: Db,
  userId: string,
  reason: string | null
): Promise<RequestResult> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) return { kind: "not_found" };

  const open = await tx.accountDeletionRequest.findFirst({
    where: { userId, status: "pending" },
    select: { id: true },
  });
  if (open) return { kind: "already_pending" };

  const request = await tx.accountDeletionRequest.create({
    data: {
      userId,
      reason: reason?.trim() || null,
      // Frozen at request time, so a later change to the policy cannot rewrite what this
      // person was told they were agreeing to.
      note: JSON.stringify(ERASURE_TERMS),
    },
    select: { id: true },
  });

  return { kind: "ok", id: request.id };
}

export function listDeletionRequests(tx: Db, status?: "pending" | "completed" | "refused") {
  return tx.accountDeletionRequest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      user: { select: { id: true, name: true, email: true, role: true, createdAt: true } },
      reviewer: { select: { name: true } },
    },
  });
}

export type CompleteResult =
  | { kind: "ok"; ordersScrubbed: number }
  | { kind: "not_found" }
  | { kind: "already_handled" }
  | { kind: "is_staff" };

/** A stable, non-reversible stand-in. Unique per account so the email column stays unique. */
function anonymousEmail(userId: string): string {
  return `deleted-${userId}@removed.invalid`;
}

/**
 * Carries out the erasure.
 *
 * Runs in one transaction: a half-erased account is worse than an un-erased one, because
 * nobody can tell which half happened.
 */
export async function completeDeletion(
  tx: Db,
  requestId: string,
  actor: { id: string; ip?: string | null; userAgent?: string | null },
  now: Date = new Date()
): Promise<CompleteResult> {
  const request = await tx.accountDeletionRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });

  if (!request) return { kind: "not_found" };
  if (request.status !== "pending") return { kind: "already_handled" };

  /**
   * Staff and admin accounts are refused here.
   *
   * Their rows are referenced by every audit entry they ever wrote, and anonymising an actor
   * is how an audit log stops answering "who did this". Removing a colleague is an HR action
   * with a different process, not a self-service button.
   */
  if (request.user.role !== "customer") return { kind: "is_staff" };

  const userId = request.user.id;
  const oldEmail = request.user.email;

  // Told before the account can no longer be reached.
  await sendEmail({
    to: oldEmail,
    template: "account-deleted",
    data: { name: request.user.name },
  });

  await tx.address.deleteMany({ where: { userId } });
  await tx.wishlistItem.deleteMany({ where: { userId } });
  await tx.stockSubscription.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.review.deleteMany({ where: { userId } });
  // Linked Google accounts hold provider tokens, which are personal data of their own.
  await tx.account.deleteMany({ where: { userId } });
  await tx.passwordResetToken.deleteMany({ where: { userId } });
  // Any pending recovery request names them and carries a token to their inbox.
  await tx.accountRecoveryRequest.deleteMany({ where: { userId } });

  /**
   * The order snapshots. These are the rows that keep a name after the account is gone.
   *
   * `shippingAddress` is frozen JSON, so it is replaced wholesale rather than edited — there
   * is no partial scrub that leaves a delivery address useful and anonymous at the same time.
   */
  const orders = await tx.order.updateMany({
    where: { userId },
    data: {
      customerName: "Deleted account",
      customerEmail: anonymousEmail(userId),
      customerPhone: "",
      guestEmail: null,
      shippingAddress: { removed: true, reason: "Erased at the customer's request" },
    },
  });

  await tx.user.update({
    where: { id: userId },
    data: {
      name: "Deleted account",
      email: anonymousEmail(userId),
      phone: null,
      recoveryEmail: null,
      passwordHash: null,
      memberNo: null,
      chapter: null,
      memberVerifiedAt: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      marketingOptIn: false,
      // Signs out every device immediately, so an open session cannot keep using the account.
      sessionsRevokedAt: now,
      disabledAt: now,
    },
  });

  await tx.accountDeletionRequest.update({
    where: { id: requestId },
    data: { status: "completed", reviewedById: actor.id, reviewedAt: now, completedAt: now },
  });

  await log(tx, {
    actorId: actor.id,
    action: "user.erase",
    entity: "User",
    entityId: userId,
    // No name and no address here either: the audit log is not an exemption from erasure.
    before: { hadOrders: orders.count },
    after: { status: "erased", ordersScrubbed: orders.count },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok", ordersScrubbed: orders.count };
}

export async function refuseDeletion(
  tx: Db,
  requestId: string,
  reason: string,
  actor: { id: string; ip?: string | null; userAgent?: string | null },
  now: Date = new Date()
): Promise<{ kind: "ok" } | { kind: "not_found" } | { kind: "already_handled" }> {
  const request = await tx.accountDeletionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { kind: "not_found" };
  if (request.status !== "pending") return { kind: "already_handled" };

  await tx.accountDeletionRequest.update({
    where: { id: requestId },
    data: { status: "refused", reviewedById: actor.id, reviewedAt: now, note: reason.trim() },
  });

  await log(tx, {
    actorId: actor.id,
    action: "user.erase_refused",
    entity: "AccountDeletionRequest",
    entityId: requestId,
    after: { status: "refused", reason: reason.trim() },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok" };
}

export const privacyService = {
  request: (userId: string, reason: string | null) =>
    db.$transaction((tx) => requestDeletion(tx, userId, reason)),
  list: (status?: "pending" | "completed" | "refused") => listDeletionRequests(db, status),
  complete: (requestId: string, actor: Parameters<typeof completeDeletion>[2]) =>
    db.$transaction((tx) => completeDeletion(tx, requestId, actor)),
  refuse: (requestId: string, reason: string, actor: Parameters<typeof refuseDeletion>[3]) =>
    db.$transaction((tx) => refuseDeletion(tx, requestId, reason, actor)),
  openRequestFor: (userId: string) =>
    db.accountDeletionRequest.findFirst({
      where: { userId, status: "pending" },
      select: { id: true, createdAt: true },
    }),
};
