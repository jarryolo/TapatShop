import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdminPage } from "@/lib/api/guard";
import { db } from "@/lib/db";
import { auditFacets, listAuditLog } from "@/lib/services/audit.service";
import { formatDateTime } from "@/lib/utils/format";

import { AuditFilters } from "./audit-filters";

export const metadata: Metadata = { title: "Audit log — TapatShop admin" };
export const dynamic = "force-dynamic";

/** Where an entity lives in the admin, so a row can link to the thing it changed. */
const ENTITY_HREF: Record<string, (id: string) => string> = {
  Product: (id) => `/admin/products/${id}`,
  Order: (id) => `/admin/orders/${id}`,
  User: (id) => `/admin/customers/${id}`,
  AccountRecoveryRequest: (id) => `/admin/recovery/${id}`,
};

/** Just the changed fields, rendered as `field: before → after`. */
function Delta({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];

  if (keys.length === 0) return <span className="text-text-muted">—</span>;

  return (
    <ul className="flex flex-col gap-0.5">
      {keys.slice(0, 6).map((key) => (
        <li key={key} className="text-[13px]">
          <span className="text-text-muted">{key}: </span>
          {key in b ? <span className="line-through opacity-60">{render(b[key])}</span> : null}
          {key in b && key in a ? <span aria-hidden="true"> → </span> : null}
          {key in a ? <span className="font-medium">{render(a[key])}</span> : null}
        </li>
      ))}
      {keys.length > 6 ? (
        <li className="text-[13px] text-text-muted">and {keys.length - 6} more</li>
      ) : null}
    </ul>
  );
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 80);
  return String(value);
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Admin only. Re-checked here, not just in middleware, per docs/02.
  await requireAdminPage();

  const params = await searchParams;

  const [{ rows, nextCursor }, facets] = await Promise.all([
    listAuditLog(db, {
      actorId: params.actorId,
      entity: params.entity,
      action: params.action,
      from: params.from,
      to: params.to,
      q: params.q,
      cursor: params.cursor,
    }),
    auditFacets(db),
  ]);

  const nextHref = () => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "cursor") next.set(key, value);
    }
    if (nextCursor) next.set("cursor", nextCursor);
    return `/admin/audit-logs?${next}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Audit log</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Every admin change, with who made it and what it was before. Times are Manila.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <div className="mt-3">
          <AuditFilters facets={facets} />
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing matches those filters"
            body="Widen the date range, or clear a filter."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const href = ENTITY_HREF[row.entity]?.(row.entityId);

              return (
                <li key={row.id} className="flex flex-col gap-2 px-4 py-4 md:px-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge>{row.action}</Badge>
                    <span className="font-semibold">
                      {row.actor?.name ?? "System"}
                      {row.actor ? (
                        <span className="ml-1 font-normal text-text-muted">({row.actor.role})</span>
                      ) : null}
                    </span>
                    {href ? (
                      <Link href={href} className="text-[13px] text-brand-600 hover:underline">
                        {row.entity}
                      </Link>
                    ) : (
                      <span className="text-[13px] text-text-muted">{row.entity}</span>
                    )}
                    <span className="ml-auto text-[13px] text-text-muted">
                      {formatDateTime(row.createdAt)}
                    </span>
                  </div>

                  <Delta before={row.before} after={row.after} />

                  {row.ip ? <p className="text-[13px] text-text-soft">from {row.ip}</p> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {nextCursor ? (
        <Link
          href={nextHref()}
          className="self-center text-sm font-semibold text-brand-600 hover:underline"
        >
          Older entries
        </Link>
      ) : null}
    </div>
  );
}
