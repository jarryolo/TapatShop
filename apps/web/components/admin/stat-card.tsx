import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A dashboard figure.
 *
 * No sparklines, no percentage-change arrows against an unstated baseline. docs/01 asks for
 * today's sales, orders awaiting action, low stock, and top products — a number and what it
 * counts. A change indicator without a comparison period is decoration that reads as data.
 */
export function StatCard({
  label,
  value,
  hint,
  action,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  action?: ReactNode;
  tone?: "default" | "attention";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-card)] md:p-5",
        tone === "attention" && "ring-1 ring-warning/30",
        className
      )}
    >
      <p className="text-[13px] font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums md:text-[32px] md:leading-tight">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[13px] text-text-muted">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
