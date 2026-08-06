import type { Prisma, PrismaClient } from "@tapatshop/db";

import { generateToken, hashToken, tokensMatch } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import type { Cents } from "@/lib/utils/money";

import { log } from "./audit.service";
import { sendEmail } from "./email.service";

/**
 * Customers, member verification, and admin-assisted account recovery.
 *
 * The recovery flow here implements docs/07 route 3 literally, including its central
 * constraint: **an admin can never read, set, or bypass a password.** The only power an
 * approval grants is sending a confirmation link to a new address; the customer completes it
 * themselves.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** The confirmation link is short-lived: it moves an account to a new owner's address. */
const RECOVERY_TOKEN_TTL_HOURS = 2;

// ─────────────────────────────  customers  ─────────────────────────────

export interface CustomerFilters {
  q?: string;
  membersOnly?: boolean;
}

/**
 * The customer list, with lifetime value.
 *
 * LTV counts paid orders only and subtracts refunds — a cancelled basket is not revenue and
 * a refunded order is revenue that came back. Two grouped queries, never one per customer.
 */
export async function listCustomers(tx: Db, filters: CustomerFilters = {}) {
  const users = await tx.user.findMany({
    where: {
      role: "customer",
      ...(filters.membersOnly ? { memberVerifiedAt: { not: null } } : {}),
      ...(filters.q?.trim()
        ? {
            OR: [
              { name: { contains: filters.q.trim() } },
              { email: { contains: filters.q.trim() } },
              { memberNo: { contains: filters.q.trim() } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      memberNo: true,
      chapter: true,
      memberVerifiedAt: true,
      emailVerifiedAt: true,
      disabledAt: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  const totals = await tx.order.groupBy({
    by: ["userId"],
    where: {
      userId: { in: users.map((user) => user.id) },
      paymentStatus: { in: ["paid", "partially_refunded", "refunded"] },
    },
    _sum: { totalCents: true, refundedCents: true },
    _count: true,
  });

  const byUser = new Map(totals.map((row) => [row.userId, row]));

  return users.map((user) => {
    const row = byUser.get(user.id);
    const gross = row?._sum.totalCents ?? 0;
    const refunded = row?._sum.refundedCents ?? 0;

    return {
      ...user,
      orderCount: row?._count ?? 0,
      lifetimeValueCents: Math.max(0, gross - refunded) as Cents,
      isMember: user.memberVerifiedAt !== null,
    };
  });
}

export async function getCustomer(tx: Db, id: string) {
  const user = await tx.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      memberNo: true,
      chapter: true,
      memberVerifiedAt: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      recoveryEmail: true,
      marketingOptIn: true,
      disabledAt: true,
      lastLoginAt: true,
      createdAt: true,
      // Deliberately absent: passwordHash. Nothing in the admin needs it, and a field that
      // is never selected cannot be leaked by a careless response.
      accounts: { select: { provider: true } },
      addresses: true,
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          orderNo: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          totalCents: true,
          refundedCents: true,
          createdAt: true,
          shippingAddress: true,
        },
      },
    },
  });

  if (!user) return null;

  const paid = user.orders.filter((order) =>
    ["paid", "partially_refunded", "refunded"].includes(order.paymentStatus)
  );

  return {
    ...user,
    isMember: user.memberVerifiedAt !== null,
    orderCount: paid.length,
    lifetimeValueCents: Math.max(
      0,
      paid.reduce((sum, order) => sum + order.totalCents - order.refundedCents, 0)
    ) as Cents,
  };
}

// ─────────────────────────────  member verification  ─────────────────────────────

export type VerifyMemberResult =
  { kind: "ok" } | { kind: "not_found" } | { kind: "member_no_taken" };

/**
 * Marks a customer a verified member. Admin-only, and audited.
 *
 * docs/01: member status is verified by an admin, never self-declared. The member number is
 * unique, so the same number cannot be attached to two accounts — that check is here rather
 * than left to a database error so the message can say what happened.
 */
export async function verifyMember(
  tx: Db,
  userId: string,
  input: {
    memberNo: string;
    chapter: string;
    actorId: string;
    ip?: string | null;
    userAgent?: string | null;
  }
): Promise<VerifyMemberResult> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, memberNo: true, chapter: true, memberVerifiedAt: true },
  });
  if (!user) return { kind: "not_found" };

  const memberNo = input.memberNo.trim();
  const clash = await tx.user.findUnique({ where: { memberNo }, select: { id: true } });
  if (clash && clash.id !== userId) return { kind: "member_no_taken" };

  await tx.user.update({
    where: { id: userId },
    data: { memberNo, chapter: input.chapter.trim(), memberVerifiedAt: new Date() },
  });

  await log(tx, {
    actorId: input.actorId,
    action: "user.verify_member",
    entity: "User",
    entityId: userId,
    before: {
      memberNo: user.memberNo,
      chapter: user.chapter,
      memberVerifiedAt: user.memberVerifiedAt,
    },
    after: { memberNo, chapter: input.chapter.trim() },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { kind: "ok" };
}

export async function revokeMember(
  tx: Db,
  userId: string,
  input: { actorId: string; ip?: string | null; userAgent?: string | null }
): Promise<void> {
  const before = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { memberNo: true, memberVerifiedAt: true },
  });

  // The number is kept for the record; only the verification is withdrawn.
  await tx.user.update({ where: { id: userId }, data: { memberVerifiedAt: null } });

  await log(tx, {
    actorId: input.actorId,
    action: "user.revoke_member",
    entity: "User",
    entityId: userId,
    before: { memberVerifiedAt: before.memberVerifiedAt },
    after: { memberVerifiedAt: null },
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

// ─────────────────────────────  admin-assisted recovery  ─────────────────────────────

export interface RecoveryClaim {
  claimedName: string;
  claimedEmail?: string | null;
  claimedMemberNo?: string | null;
  claimedOrderNo?: string | null;
  claimedAddress?: string | null;
  newEmail: string;
}

/**
 * Files a recovery request from the public form.
 *
 * Always succeeds from the caller's point of view, whatever we can or cannot match. Telling
 * someone "no account matches that" would make this form an account oracle, and the people
 * using it are already locked out and anxious.
 */
export async function fileRecoveryRequest(tx: Db, claim: RecoveryClaim): Promise<string> {
  // Best-effort match, for the admin's convenience. Never surfaced to the requester.
  let userId: string | null = null;

  if (claim.claimedMemberNo?.trim()) {
    const byMember = await tx.user.findUnique({
      where: { memberNo: claim.claimedMemberNo.trim() },
      select: { id: true },
    });
    userId = byMember?.id ?? null;
  }

  if (!userId && claim.claimedOrderNo?.trim()) {
    const order = await tx.order.findUnique({
      where: { orderNo: claim.claimedOrderNo.trim().toUpperCase() },
      select: { userId: true },
    });
    userId = order?.userId ?? null;
  }

  if (!userId && claim.claimedEmail?.trim()) {
    const byEmail = await tx.user.findUnique({
      where: { email: claim.claimedEmail.trim().toLowerCase() },
      select: { id: true },
    });
    userId = byEmail?.id ?? null;
  }

  const request = await tx.accountRecoveryRequest.create({
    data: {
      userId,
      claimedName: claim.claimedName.trim(),
      claimedEmail: claim.claimedEmail?.trim().toLowerCase() || null,
      claimedMemberNo: claim.claimedMemberNo?.trim() || null,
      claimedOrderNo: claim.claimedOrderNo?.trim().toUpperCase() || null,
      claimedAddress: claim.claimedAddress?.trim() || null,
      newEmail: claim.newEmail.trim().toLowerCase(),
    },
    select: { id: true },
  });

  return request.id;
}

/**
 * What the admin checks the claim against.
 *
 * docs/07 requires two matching data points minimum. This does not decide — it lays the
 * evidence out and a person decides, which is the entire point of calling it
 * admin-*assisted*.
 */
export async function recoveryEvidence(tx: Db, requestId: string) {
  const request = await tx.accountRecoveryRequest.findUnique({
    where: { id: requestId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          memberNo: true,
          chapter: true,
          memberVerifiedAt: true,
        },
      },
      reviewer: { select: { name: true } },
    },
  });

  if (!request) return null;

  const orders = request.user
    ? await tx.order.findMany({
        where: { userId: request.user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          orderNo: true,
          createdAt: true,
          totalCents: true,
          shippingAddress: true,
        },
      })
    : [];

  const claimedOrder = request.claimedOrderNo
    ? await tx.order.findUnique({
        where: { orderNo: request.claimedOrderNo },
        select: { orderNo: true, userId: true, shippingAddress: true, customerName: true },
      })
    : null;

  // Each check is reported separately so the admin can count them, per docs/07.
  const checks = {
    nameMatches:
      Boolean(request.user) &&
      request.user!.name.trim().toLowerCase() === request.claimedName.trim().toLowerCase(),
    memberNoMatches:
      Boolean(request.claimedMemberNo) && request.user?.memberNo === request.claimedMemberNo,
    orderBelongsToUser: Boolean(
      claimedOrder && request.user && claimedOrder.userId === request.user.id
    ),
    addressMatches: Boolean(
      request.claimedAddress &&
      claimedOrder &&
      JSON.stringify(claimedOrder.shippingAddress)
        .toLowerCase()
        .includes(request.claimedAddress.trim().toLowerCase().slice(0, 12))
    ),
  };

  return {
    request,
    orders,
    claimedOrder,
    checks,
    matchCount: Object.values(checks).filter(Boolean).length,
  };
}

export type ApproveRecoveryResult =
  | { kind: "ok"; token: string }
  | { kind: "not_found" }
  | { kind: "no_user_matched" }
  | { kind: "already_handled" };

/**
 * Approves a request and sends a confirmation link to the NEW address.
 *
 * This is the only thing approval does. It does not change the login email — the customer
 * does that by opening the link — and it cannot touch a password. docs/07: the admin never
 * sets a password and never sees one.
 */
export async function approveRecovery(
  tx: Db,
  requestId: string,
  input: { actorId: string; note?: string; ip?: string | null; userAgent?: string | null },
  now: Date = new Date()
): Promise<ApproveRecoveryResult> {
  const request = await tx.accountRecoveryRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { id: true, email: true, name: true, phone: true } } },
  });

  if (!request) return { kind: "not_found" };
  if (request.status !== "pending") return { kind: "already_handled" };
  if (!request.user) return { kind: "no_user_matched" };

  const token = generateToken();

  await tx.accountRecoveryRequest.update({
    where: { id: requestId },
    data: {
      status: "approved",
      reviewedById: input.actorId,
      reviewedAt: now,
      reviewNote: input.note?.trim() || null,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + RECOVERY_TOKEN_TTL_HOURS * 3_600_000),
    },
  });

  await sendEmail({
    to: request.newEmail,
    template: "account-recovery-approved",
    data: { name: request.user.name, token },
  });

  await log(tx, {
    actorId: input.actorId,
    action: "recovery.approve",
    entity: "AccountRecoveryRequest",
    entityId: requestId,
    before: { status: "pending" },
    after: { status: "approved", newEmail: request.newEmail, userId: request.user.id },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { kind: "ok", token };
}

export async function rejectRecovery(
  tx: Db,
  requestId: string,
  input: { actorId: string; note: string; ip?: string | null; userAgent?: string | null },
  now: Date = new Date()
): Promise<boolean> {
  const request = await tx.accountRecoveryRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "pending") return false;

  await tx.accountRecoveryRequest.update({
    where: { id: requestId },
    data: {
      status: "rejected",
      reviewedById: input.actorId,
      reviewedAt: now,
      reviewNote: input.note.trim(),
    },
  });

  await log(tx, {
    actorId: input.actorId,
    action: "recovery.reject",
    entity: "AccountRecoveryRequest",
    entityId: requestId,
    before: { status: "pending" },
    after: { status: "rejected", note: input.note.trim() },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return true;
}

export type ConfirmRecoveryResult = { kind: "ok"; userId: string } | { kind: "invalid" };

/**
 * The customer opens the link and their login email moves.
 *
 * Notice what happens and what does not: the email changes, every session is revoked, and
 * the OLD address is told — docs/07 requires the previous address be notified so a hijack is
 * detectable. No password is set. The customer signs in afterwards with "forgot password"
 * against their new address, which is a flow they control end to end.
 */
export async function confirmRecovery(
  tx: Db,
  token: string,
  now: Date = new Date()
): Promise<ConfirmRecoveryResult> {
  const candidateHash = hashToken(token);

  const request = await tx.accountRecoveryRequest.findFirst({
    where: {
      tokenHash: candidateHash,
      status: "approved",
      expiresAt: { gt: now },
    },
    include: { user: { select: { id: true, email: true, name: true, phone: true } } },
  });

  if (!request?.user || !request.tokenHash || !tokensMatch(candidateHash, request.tokenHash)) {
    return { kind: "invalid" };
  }

  const oldEmail = request.user.email;

  await tx.user.update({
    where: { id: request.user.id },
    data: {
      email: request.newEmail,
      // The new address is unproven until they use it, and this link proves it.
      emailVerifiedAt: now,
      // Anyone holding a session from before this moment loses it.
      sessionsRevokedAt: now,
    },
  });

  await tx.accountRecoveryRequest.update({
    where: { id: request.id },
    data: { status: "confirmed", confirmedAt: now, tokenHash: null },
  });

  // Both addresses hear about it. The old one is how a hijack gets noticed.
  await sendEmail({
    to: oldEmail,
    template: "email-changed",
    data: { name: request.user.name, newEmail: request.newEmail, wasYou: "false" },
  });
  await sendEmail({
    to: request.newEmail,
    template: "email-changed",
    data: { name: request.user.name, newEmail: request.newEmail, wasYou: "true" },
  });

  // docs/07 also asks for an SMS to the verified phone. There is no SMS transport yet, so
  // that half is missing rather than silently considered done.

  // Step 5: every step writes a row. The actor here is the customer, not an admin — the
  // approval and this confirmation are two different people acting, and the log should show
  // that rather than crediting the whole change to whoever approved it.
  await log(tx, {
    actorId: request.user.id,
    action: "recovery.confirm",
    entity: "AccountRecoveryRequest",
    entityId: request.id,
    before: { status: "approved", email: oldEmail },
    after: { status: "confirmed", email: request.newEmail },
  });

  return { kind: "ok", userId: request.user.id };
}

export async function listRecoveryRequests(
  tx: Db,
  status?: "pending" | "approved" | "confirmed" | "rejected"
) {
  return tx.accountRecoveryRequest.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, name: true, email: true } },
      reviewer: { select: { name: true } },
    },
  });
}

export const customerService = {
  list: (filters?: CustomerFilters) => listCustomers(db, filters),
  get: (id: string) => getCustomer(db, id),
  verifyMember: (userId: string, input: Parameters<typeof verifyMember>[2]) =>
    db.$transaction((tx) => verifyMember(tx, userId, input)),
  revokeMember: (userId: string, input: Parameters<typeof revokeMember>[2]) =>
    db.$transaction((tx) => revokeMember(tx, userId, input)),
  fileRecovery: (claim: RecoveryClaim) => db.$transaction((tx) => fileRecoveryRequest(tx, claim)),
  evidence: (requestId: string) => recoveryEvidence(db, requestId),
  approve: (requestId: string, input: Parameters<typeof approveRecovery>[2]) =>
    db.$transaction((tx) => approveRecovery(tx, requestId, input)),
  reject: (requestId: string, input: Parameters<typeof rejectRecovery>[2]) =>
    db.$transaction((tx) => rejectRecovery(tx, requestId, input)),
  confirm: (token: string) => db.$transaction((tx) => confirmRecovery(tx, token)),
  listRecovery: (status?: "pending" | "approved" | "confirmed" | "rejected") =>
    listRecoveryRequests(db, status),
};
