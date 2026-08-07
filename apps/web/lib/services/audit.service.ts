import type { Prisma, PrismaClient } from "@tapatshop/db";

/**
 * The audit log. Every admin mutation writes one — docs/CLAUDE.md, invariant I8.
 *
 * "Who changed this product's price, when, and what was it before" is a question the client
 * asked for directly (docs/01), and it is unanswerable after the fact unless the row is
 * written at the time of the change.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** `entity.verb`, matching the examples in the schema: product.update, order.refund. */
export type AuditAction =
  | "product.create"
  | "product.update"
  | "product.publish"
  | "product.unpublish"
  | "product.archive"
  | "product.delete"
  | "variant.create"
  | "variant.update"
  | "variant.delete"
  | "image.reorder"
  | "image.update"
  | "category.create"
  | "category.update"
  | "category.delete"
  | "order.transition"
  | "order.refund"
  | "coupon.create"
  | "coupon.update"
  | "coupon.delete"
  | "banner.create"
  | "banner.update"
  | "banner.delete"
  | "user.two_factor_enabled"
  | "user.two_factor_disabled"
  | "user.recovery_code_used"
  | "user.erase"
  | "user.erase_refused"
  | "review.approve"
  | "review.reject"
  | "inventory.adjust"
  | "user.verify_member"
  | "user.revoke_member"
  | "user.role_change"
  // Distinct from user.role_change on purpose. "Who approved account recoveries, and on what
  // evidence" is a question someone will ask after an incident, and folding it into a generic
  // action makes it unanswerable without reading every row's payload.
  | "recovery.approve"
  | "recovery.reject"
  | "recovery.confirm"
  | "setting.update";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Fields that must never reach the audit log.
 *
 * The log is readable by every admin and is exactly the kind of table that gets exported
 * into a spreadsheet. A password hash or a raw provider payload has no business in it.
 */
const REDACTED = new Set([
  "passwordHash",
  "totpSecret",
  "recoveryCodes",
  "tokenHash",
  "codeHash",
  "accessToken",
  "refreshToken",
  "rawPayload",
]);

/** Shallow copy with the sensitive keys removed. */
export function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object") return value as Prisma.InputJsonValue;

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item)) as Prisma.InputJsonValue;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED.has(key)) continue;
    output[key] = entry instanceof Date ? entry.toISOString() : scrub(entry);
  }
  return output as Prisma.InputJsonValue;
}

/**
 * Writes an audit row.
 *
 * Pass the same transaction client as the mutation it records. A log written outside the
 * transaction survives a rollback and describes a change that never happened — which is
 * worse than no log at all, because it is believed.
 */
export async function log(tx: Db, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: scrub(entry.before),
      after: scrub(entry.after),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

/**
 * The subset of fields that actually changed, as `{ before, after }`.
 *
 * An audit entry holding the full row before and after makes the reader diff two blobs by
 * eye to find the one field that moved. Recording only the delta makes "who changed the
 * price" a glance rather than an investigation.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const beforeChanged: Record<string, unknown> = {};
  const afterChanged: Record<string, unknown> = {};

  for (const [key, next] of Object.entries(after)) {
    if (next === undefined) continue;

    const previous = before[key];
    const same =
      previous instanceof Date && next instanceof Date
        ? previous.getTime() === next.getTime()
        : previous === next;

    if (!same) {
      beforeChanged[key] = previous;
      afterChanged[key] = next;
    }
  }

  return { before: beforeChanged, after: afterChanged };
}

// ─────────────────────────────  reading the log  ─────────────────────────────

export interface AuditFilters {
  actorId?: string | null;
  entity?: string | null;
  action?: string | null;
  /** Manila calendar days, `YYYY-MM-DD`, inclusive at both ends. */
  from?: string | null;
  to?: string | null;
  q?: string | null;
  limit?: number;
  cursor?: string | null;
}

/**
 * A date the admin typed, as the UTC instant that Manila day begins or ends.
 *
 * Filtering on the raw string would compare a Manila date against a UTC timestamp and quietly
 * drop the first eight hours of every day — the same trap the dashboard's "today" avoids.
 */
function manilaBoundary(day: string, edge: "start" | "end"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = edge === "start" ? "00:00:00.000" : "23:59:59.999";
  const parsed = new Date(`${day}T${time}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function auditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const from = filters.from ? manilaBoundary(filters.from, "start") : null;
  const to = filters.to ? manilaBoundary(filters.to, "end") : null;

  return {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.entity ? { entity: filters.entity } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    // Matches the entity id directly, so pasting an order or product id finds its history.
    ...(filters.q?.trim() ? { entityId: filters.q.trim() } : {}),
  };
}

/**
 * A page of the log, newest first.
 *
 * Cursor paginated rather than offset: this table only grows, and an offset deep into it
 * makes MySQL walk every row it skips.
 */
export async function listAuditLog(tx: Db, filters: AuditFilters = {}) {
  const take = Math.min(filters.limit ?? 50, 200);

  const rows = await tx.auditLog.findMany({
    where: auditWhere(filters),
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    include: { actor: { select: { id: true, name: true, email: true, role: true } } },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return { rows: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}

/** The distinct actors, entities and actions present, to fill the filter dropdowns. */
export async function auditFacets(tx: Db) {
  const [actors, entities, actions] = await Promise.all([
    tx.user.findMany({
      where: { role: { in: ["admin", "staff"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    tx.auditLog.findMany({
      distinct: ["entity"],
      select: { entity: true },
      orderBy: { entity: "asc" },
    }),
    tx.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);

  return {
    actors,
    entities: entities.map((row) => row.entity),
    actions: actions.map((row) => row.action),
  };
}
