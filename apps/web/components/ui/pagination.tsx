import Link from "next/link";

import { cn } from "@/lib/utils/cn";

/**
 * Builds the page list with ellipses: 1 … 4 5 6 … 20.
 *
 * Always shows the first and last page plus a window around the current one, so the control
 * never changes width as you page through and the buttons stop moving under the cursor.
 */
export function pageItems(current: number, total: number, window = 1): (number | "gap")[] {
  if (total <= 1) return [1];

  const pages = new Set<number>([1, total]);
  for (let p = current - window; p <= current + window; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const output: (number | "gap")[] = [];

  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) output.push("gap");
    output.push(page);
    previous = page;
  }
  return output;
}

export function Pagination({
  current,
  total,
  hrefFor,
  className,
}: {
  current: number;
  total: number;
  /** Pagination is URL state, so every page is a real link — shareable and refreshable. */
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (total <= 1) return null;

  const items = pageItems(current, total);
  const cell =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-ctrl)] px-3 text-[15px]";

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-center gap-1", className)}
    >
      {current > 1 ? (
        <Link
          href={hrefFor(current - 1)}
          rel="prev"
          className={cn(cell, "text-text-muted hover:bg-brand-50 hover:text-brand-600")}
        >
          Previous
        </Link>
      ) : (
        <span className={cn(cell, "cursor-not-allowed text-text-soft")} aria-hidden="true">
          Previous
        </span>
      )}

      {items.map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} className={cn(cell, "text-text-soft")} aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={hrefFor(item)}
            aria-current={item === current ? "page" : undefined}
            aria-label={`Page ${item}`}
            className={cn(
              cell,
              item === current
                ? "bg-brand-600 font-semibold text-white"
                : "text-text hover:bg-brand-50 hover:text-brand-600"
            )}
          >
            {item}
          </Link>
        )
      )}

      {current < total ? (
        <Link
          href={hrefFor(current + 1)}
          rel="next"
          className={cn(cell, "text-text-muted hover:bg-brand-50 hover:text-brand-600")}
        >
          Next
        </Link>
      ) : (
        <span className={cn(cell, "cursor-not-allowed text-text-soft")} aria-hidden="true">
          Next
        </span>
      )}
    </nav>
  );
}
