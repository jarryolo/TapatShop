import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

import { controlClasses, describedBy } from "./field";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  hint?: string;
  error?: string;
  /** Rendered inside the control, e.g. a peso sign or a search icon. */
  prefix?: string;
}

export function Input({ id, hint, error, prefix, className, ...props }: InputProps) {
  const control = (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, { hint, error })}
      className={cn(controlClasses, "h-11", prefix && "pl-8", className)}
      {...props}
    />
  );

  if (!prefix) return control;

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-text-muted">
        {prefix}
      </span>
      {control}
    </div>
  );
}

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  id: string;
  hint?: string;
  error?: string;
}

export function Textarea({ id, hint, error, className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      id={id}
      rows={rows}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, { hint, error })}
      className={cn(controlClasses, "resize-y py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  id: string;
  hint?: string;
  error?: string;
}

export function Select({ id, hint, error, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={cn(controlClasses, "h-11 appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    </div>
  );
}
