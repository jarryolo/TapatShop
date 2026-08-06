import { cn } from "@/lib/utils/cn";

/**
 * Loading placeholder. Always `aria-hidden` — a screen reader should hear the live region
 * on the container, not a description of grey rectangles.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-[var(--radius-ctrl)] bg-border-subtle", className)}
    />
  );
}

/** Matches the product card layout so the grid does not reflow when data arrives. */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-[var(--radius-card)] bg-surface p-3 shadow-[var(--shadow-card)]">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="mt-3 h-4 w-4/5" />
      <Skeleton className="mt-2 h-4 w-3/5" />
      <Skeleton className="mt-3 h-5 w-1/3" />
    </div>
  );
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 border-b border-border-subtle px-4 py-3">
      {Array.from({ length: columns }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === 0 ? "w-1/3" : "flex-1")} />
      ))}
    </div>
  );
}
