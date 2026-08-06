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
  | "inventory.adjust"
  | "user.verify_member"
  | "user.role_change"
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
