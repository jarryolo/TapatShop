import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Label, control, hint, and error, wired together.
 *
 * The error is linked with aria-describedby and marked aria-invalid on the control —
 * docs/05 requires it, and without it a screen reader user hits submit, hears nothing, and
 * has no idea which field is wrong.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-text">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children}

      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[13px] text-text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The ids a control should point at, given whether it has a hint or an error. */
export function describedBy(
  id: string,
  opts: { hint?: string; error?: string }
): string | undefined {
  const ids: string[] = [];
  if (opts.error) ids.push(`${id}-error`);
  else if (opts.hint) ids.push(`${id}-hint`);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** Shared look for text-entry controls. 44px tall, visible focus ring, clear error state. */
export const controlClasses = [
  "w-full rounded-[var(--radius-ctrl)] border bg-surface px-3 text-[15px] text-text",
  "placeholder:text-text-soft",
  "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-out-soft)]",
  "focus:outline-none focus-visible:outline-none",
  "focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--color-brand-100)]",
  "disabled:cursor-not-allowed disabled:bg-page disabled:text-text-soft",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_3px_var(--color-danger-soft)]",
].join(" ");
