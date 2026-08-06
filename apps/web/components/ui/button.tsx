import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. The label stays put so the button never jumps. */
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-800 active:bg-brand-900 border border-transparent",
  secondary:
    "bg-surface text-text border border-border-strong hover:bg-brand-50 hover:border-brand-200 active:bg-brand-100",
  ghost:
    "bg-transparent text-brand-600 border border-transparent hover:bg-brand-50 active:bg-brand-100",
  danger: "bg-danger text-white hover:brightness-95 active:brightness-90 border border-transparent",
};

// 44px minimum touch target on md and lg, per docs/05. sm is for dense admin tables only.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-[13px] gap-1.5",
  md: "h-11 px-4 text-[15px] gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

/**
 * The one button. Never more than one `primary` per view — docs/05.
 *
 * `loading` implies disabled: a form that can be submitted twice while the first request is
 * in flight is how duplicate orders happen.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  iconLeft,
  iconRight,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center rounded-[var(--radius-ctrl)] font-semibold",
        "transition-[background-color,border-color,filter] duration-150 ease-[var(--ease-out-soft)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {loading ? (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner className="size-4" />
        </span>
      ) : null}
      <span
        className={cn(
          "inline-flex items-center",
          SIZES[size].includes("gap") && "gap-2",
          loading && "invisible"
        )}
      >
        {iconLeft}
        {children}
        {iconRight}
      </span>
    </button>
  );
}
