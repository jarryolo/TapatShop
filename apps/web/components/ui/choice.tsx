"use client";

import type { InputHTMLAttributes } from "react";
import { useState } from "react";

import { cn } from "@/lib/utils/cn";

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
  id: string;
  label: string;
  hint?: string;
};

const boxClasses = [
  "peer size-5 shrink-0 appearance-none border-2 border-border-strong bg-surface",
  "transition-[background-color,border-color] duration-150 ease-[var(--ease-out-soft)]",
  "checked:border-brand-600 checked:bg-brand-600",
  "hover:border-brand-400",
  "disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-page",
].join(" ");

/** The 44px touch target is on the label, not the 20px box — docs/05. */
const rowClasses =
  "flex min-h-11 cursor-pointer items-center gap-3 py-1.5 text-[15px] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-text-soft";

export function Checkbox({ id, label, hint, className, ...props }: ChoiceProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <label htmlFor={id} className={rowClasses}>
        <span className="relative inline-flex items-center">
          <input id={id} type="checkbox" className={cn(boxClasses, "rounded-[5px]")} {...props} />
          <svg
            className="pointer-events-none absolute left-0.5 top-0.5 size-4 text-white opacity-0 peer-checked:opacity-100"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 8.5l3.2 3.2L13 5"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span>{label}</span>
      </label>
      {hint ? <p className="ml-8 text-[13px] text-text-muted">{hint}</p> : null}
    </div>
  );
}

export function Radio({ id, label, hint, className, ...props }: ChoiceProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <label htmlFor={id} className={rowClasses}>
        <span className="relative inline-flex items-center">
          <input id={id} type="radio" className={cn(boxClasses, "rounded-full")} {...props} />
          <span className="pointer-events-none absolute left-1.5 top-1.5 size-2 rounded-full bg-white opacity-0 peer-checked:opacity-100" />
        </span>
        <span>{label}</span>
      </label>
      {hint ? <p className="ml-8 text-[13px] text-text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A real button with role="switch", not a styled checkbox.
 *
 * Screen readers announce "on"/"off" rather than "checked", which is what a setting toggle
 * should say. Space and Enter both activate it because it is a button.
 */
export function Switch({
  id,
  label,
  hint,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultChecked);
  const isOn = checked ?? internal;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <label htmlFor={id} className={cn("text-[15px]", disabled && "text-text-soft")}>
          {label}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-describedby={hint ? `${id}-hint` : undefined}
          disabled={disabled}
          onClick={() => {
            const next = !isOn;
            if (checked === undefined) setInternal(next);
            onCheckedChange?.(next);
          }}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 ease-[var(--ease-out-soft)]",
            isOn ? "bg-brand-600" : "bg-border-strong",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] duration-150 ease-[var(--ease-out-soft)]",
              isOn ? "left-[22px]" : "left-0.5"
            )}
          />
        </button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
