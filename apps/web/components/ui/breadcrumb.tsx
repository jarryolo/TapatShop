import Link from "next/link";

import { cn } from "@/lib/utils/cn";

export interface Crumb {
  label: string;
  href?: string;
}

/** The last crumb is the current page: not a link, and marked aria-current. */
export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-text-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link href={item.href} className="rounded hover:text-brand-600 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(isLast && "font-medium text-text")}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <svg
                  viewBox="0 0 16 16"
                  className="size-3 text-text-soft"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M6 3l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
