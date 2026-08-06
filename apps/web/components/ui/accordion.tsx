import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

/**
 * Built on <details>/<summary>.
 *
 * Keyboard support, the expanded/collapsed announcement, and in-page find all come from the
 * platform. A div-based accordion has to reimplement each of those, and usually misses the
 * last one — a customer using Ctrl+F to find a size in a collapsed section finds nothing.
 */
export function Accordion({ items, className }: { items: AccordionItem[]; className?: string }) {
  return (
    <div className={cn("divide-y divide-border-subtle border-y border-border-subtle", className)}>
      {items.map((item) => (
        <details key={item.id} name="accordion" className="group">
          <summary
            className={cn(
              "flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] font-semibold",
              "hover:text-brand-600 [&::-webkit-details-marker]:hidden"
            )}
          >
            {item.title}
            <svg
              viewBox="0 0 16 16"
              className="size-4 shrink-0 text-text-muted transition-transform duration-150 ease-[var(--ease-out-soft)] group-open:rotate-180"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </summary>
          <div className="pb-4 text-[15px] text-text-muted">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
