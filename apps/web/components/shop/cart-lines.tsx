"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PricedLine } from "@/lib/services/cart.service";
import { formatPeso } from "@/lib/utils/money";

/**
 * A cart line, with whatever went wrong since it was added stated plainly.
 *
 * docs/05: errors say what happened and what to do. "Out of stock" on its own leaves the
 * customer to work out that the line is not being charged for.
 */
function IssueNote({ line }: { line: PricedLine }) {
  if (!line.issue) return null;

  switch (line.issue.kind) {
    case "out_of_stock":
      return (
        <p className="mt-1 text-[13px] text-danger-text">
          Out of stock. Remove it to check out, or come back when it is restocked.
        </p>
      );
    case "unavailable":
      return (
        <p className="mt-1 text-[13px] text-danger-text">No longer sold. Remove it to check out.</p>
      );
    case "reduced":
      return (
        <p className="mt-1 text-[13px] text-warning-text">
          Only {line.issue.available} left, so you are being charged for {line.issue.available} of
          the {line.issue.requested} you wanted.
        </p>
      );
  }
}

export function CartLines({
  lines,
  onUpdate,
  onRemove,
  pending,
  compact = false,
}: {
  lines: PricedLine[];
  onUpdate: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  pending: boolean;
  compact?: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {lines.map((line) => (
        <li key={line.id} className="flex gap-3 py-4 first:pt-0">
          <div className="size-16 shrink-0 overflow-hidden rounded-[var(--radius-ctrl)] bg-page">
            {line.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={line.imageUrl} alt="" className="size-full object-cover" />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <Link
              href={`/products/${line.productSlug}`}
              className="block truncate font-semibold hover:text-brand-600"
            >
              {line.productName}
            </Link>
            <p className="truncate text-[13px] text-text-muted">{line.variantName}</p>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="sr-only-live" htmlFor={`qty-${line.id}`}>
                Quantity for {line.productName}
              </label>
              <select
                id={`qty-${line.id}`}
                value={line.quantity}
                disabled={
                  pending ||
                  line.issue?.kind === "out_of_stock" ||
                  line.issue?.kind === "unavailable"
                }
                onChange={(event) => onUpdate(line.id, Number(event.target.value))}
                className="h-9 rounded-[var(--radius-ctrl)] border border-border-strong px-2 text-sm disabled:bg-page disabled:text-text-soft"
              >
                {/* Options stop at what exists, so the control cannot ask for the impossible. */}
                {Array.from(
                  { length: Math.max(1, Math.min(10, line.stockQty)) },
                  (_, i) => i + 1
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onRemove(line.id)}
              >
                Remove
              </Button>
            </div>

            <IssueNote line={line} />
          </div>

          <div className="shrink-0 text-right">
            <p className="font-semibold tabular-nums">{formatPeso(line.lineTotalCents)}</p>
            {line.listPriceCents ? (
              <p className="text-[13px] text-text-soft line-through">
                {formatPeso(line.listPriceCents * line.quantity)}
              </p>
            ) : null}
            {!compact ? (
              <p className="mt-1 text-[13px] text-text-muted">
                {formatPeso(line.unitPriceCents)} each
              </p>
            ) : null}
            {line.issue?.kind === "out_of_stock" || line.issue?.kind === "unavailable" ? (
              <Badge tone="neutral">Not charged</Badge>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
