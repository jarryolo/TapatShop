import { cn } from "@/lib/utils/cn";
import { type Cents, formatPeso } from "@/lib/utils/money";

export interface PriceProps {
  /** What the customer pays. Already the member price if one applies — see docs/01. */
  cents: Cents;
  /** The struck-through was-price. Ignored unless it is genuinely higher. */
  compareAtCents?: Cents | null;
  /** Marks this as a verified member's price. Never shown to guests or non-members. */
  isMemberPrice?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: { current: "text-[15px]", compare: "text-[13px]" },
  md: { current: "text-lg", compare: "text-sm" },
  lg: { current: "text-2xl", compare: "text-base" },
} as const;

/**
 * Renders centavos as pesos. The only component that displays money.
 *
 * The compare-at price is dropped unless it is actually higher than what is being charged.
 * A struck-through price that is not a real saving is exactly the manipulation docs/01
 * rules out, and the guard means a bad admin entry cannot produce one by accident.
 */
export function Price({
  cents,
  compareAtCents,
  isMemberPrice = false,
  size = "md",
  className,
}: PriceProps) {
  const showCompare = typeof compareAtCents === "number" && compareAtCents > cents;
  const styles = SIZES[size];

  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-2", className)}>
      <span className={cn("font-semibold text-text", styles.current)}>{formatPeso(cents)}</span>

      {showCompare ? (
        <span className={cn("text-text-soft line-through", styles.compare)}>
          <span className="sr-only-live">Was </span>
          {formatPeso(compareAtCents)}
        </span>
      ) : null}

      {isMemberPrice ? (
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
          Member price
        </span>
      ) : null}
    </span>
  );
}
