"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { type SortState, filterRows, nextSort, paginate, sortRows } from "@/lib/admin/table";
import { cn } from "@/lib/utils/cn";

export interface Column<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right";
  /** Custom cell. Without it the raw value is rendered. */
  render?: (row: T) => ReactNode;
  /** Hidden below md. For columns that are useful but not essential on a phone. */
  secondary?: boolean;
}

export interface DataTableProps<T extends Record<string, unknown>> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  /** Stable row identity. Index would break selection the moment the sort changes. */
  rowKey: (row: T) => string;
  /** Columns the search box looks at. Omit to disable search. */
  searchKeys?: readonly (keyof T)[];
  searchPlaceholder?: string;
  perPage?: number;
  onRowActivate?: (row: T) => void;
  emptyTitle?: string;
  emptyBody?: string;
  caption: string;
}

/**
 * The admin table. Dense by design — docs/05 says the spacious storefront rules do not apply
 * here.
 *
 * Sorting, filtering, and pagination live in lib/admin/table.ts as pure functions so they can
 * be tested without rendering. This component is the keyboard and ARIA layer over them.
 */
export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  rowKey,
  searchKeys,
  searchPlaceholder = "Search",
  perPage = 10,
  onRowActivate,
  emptyTitle = "Nothing here yet",
  emptyBody,
  caption,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const visible = useMemo(() => {
    const filtered = searchKeys ? filterRows(rows, query, searchKeys) : [...rows];
    return sortRows(filtered, sort);
  }, [rows, query, sort, searchKeys]);

  // paginate clamps, so filtering down while on a late page cannot strand you on an empty one.
  const current = paginate(visible, page, perPage);

  /**
   * Up and down move between rows, Home and End jump to the ends, Enter or Space activates.
   * Rows carry tabIndex -1 and are reached through the table rather than each becoming its own
   * tab stop — a 10-row table would otherwise cost 10 stops to get past.
   */
  const onRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, row: T, index: number) => {
    const rowNodes = bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]");
    if (!rowNodes) return;

    const focusRow = (target: number) => {
      const clamped = Math.min(Math.max(0, target), rowNodes.length - 1);
      rowNodes[clamped]?.focus();
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rowNodes.length - 1);
        break;
      case "Enter":
      case " ":
        if (onRowActivate) {
          event.preventDefault();
          onRowActivate(row);
        }
        break;
      default:
        break;
    }
  };

  const ariaSort = (column: Column<T>): "ascending" | "descending" | "none" | undefined => {
    if (!column.sortable) return undefined;
    if (sort?.key !== column.key) return "none";
    return sort.direction === "asc" ? "ascending" : "descending";
  };

  return (
    <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
      {searchKeys ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-t-[var(--radius-card)] border-b border-border-subtle bg-surface px-4 py-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="table-search" className="sr-only-live">
              {searchPlaceholder}
            </label>
            <Input
              id="table-search"
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <p className="text-[13px] text-text-muted" role="status" aria-live="polite">
            {current.total} {current.total === 1 ? "result" : "results"}
          </p>
        </div>
      ) : null}

      {current.total === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[15px]">
            <caption className="sr-only-live">{caption}</caption>
            <thead>
              <tr className="border-b border-border-subtle">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={ariaSort(column)}
                    className={cn(
                      "px-4 py-2.5 text-[13px] font-semibold text-text-muted",
                      column.align === "right" && "text-right",
                      column.secondary && "hidden md:table-cell"
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => setSort((s) => nextSort(s, column.key))}
                        className="inline-flex items-center gap-1 rounded hover:text-text"
                      >
                        {column.header}
                        <SortGlyph state={sort?.key === column.key ? sort.direction : null} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody ref={bodyRef}>
              {current.rows.map((row, index) => (
                <tr
                  key={rowKey(row)}
                  data-row
                  tabIndex={index === 0 ? 0 : -1}
                  onKeyDown={(event) => onRowKeyDown(event, row, index)}
                  onClick={onRowActivate ? () => onRowActivate(row) : undefined}
                  className={cn(
                    "border-b border-border-subtle last:border-0",
                    onRowActivate && "cursor-pointer hover:bg-page"
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-4 py-3 align-middle",
                        column.align === "right" && "text-right tabular-nums",
                        column.secondary && "hidden md:table-cell"
                      )}
                    >
                      {column.render ? column.render(row) : String(row[column.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-4 border-t border-border-subtle px-4 py-3">
          <p className="text-[13px] text-text-muted">
            Page {current.page} of {current.totalPages}
          </p>
          <div className="flex gap-2">
            <PagerButton onClick={() => setPage(current.page - 1)} disabled={current.page <= 1}>
              Previous
            </PagerButton>
            <PagerButton
              onClick={() => setPage(current.page + 1)}
              disabled={current.page >= current.totalPages}
            >
              Next
            </PagerButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PagerButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-9 rounded-[var(--radius-ctrl)] border border-border-strong px-3 text-[13px] font-semibold hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
    >
      {children}
    </button>
  );
}

function SortGlyph({ state }: { state: "asc" | "desc" | null }) {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
      <path
        d="M3 5l3-3 3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={state === "asc" ? 1 : 0.3}
      />
      <path
        d="M3 7l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={state === "desc" ? 1 : 0.3}
      />
    </svg>
  );
}
