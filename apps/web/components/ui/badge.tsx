import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "brand";

/**
 * Pale fill with darker text from the same family. Never black text on a colour fill —
 * docs/05. Each pairing below clears 4.5:1.
 */
const TONES: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  neutral: "bg-page text-text-muted ring-1 ring-inset ring-border-subtle",
  brand: "bg-brand-50 text-brand-800",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONES[tone],
        className
      )}
      {...props}
    />
  );
}
