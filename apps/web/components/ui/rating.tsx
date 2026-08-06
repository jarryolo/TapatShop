"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils/cn";

function Star({ fill, className }: { fill: number; className?: string }) {
  // fill is 0..1. A clip rectangle gives half stars without a second icon.
  const clipId = useId();
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn("size-5", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={20 * fill} height="20" />
        </clipPath>
      </defs>
      <path
        d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L1.5 7.7l5.9-.9L10 1.5z"
        className="fill-border-strong"
      />
      <path
        d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L1.5 7.7l5.9-.9L10 1.5z"
        className="fill-warning"
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}

/** Read-only display. The number is announced; the stars are decoration. */
export function Rating({
  value,
  count,
  className,
}: {
  value: number;
  count?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, value));

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="inline-flex">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} fill={Math.max(0, Math.min(1, clamped - i))} />
        ))}
      </span>
      <span className="text-sm text-text-muted">
        {clamped.toFixed(1)}
        {typeof count === "number" ? ` (${count})` : ""}
      </span>
      <span className="sr-only-live">
        Rated {clamped.toFixed(1)} out of 5
        {typeof count === "number" ? ` from ${count} reviews` : ""}
      </span>
    </span>
  );
}

/**
 * Input mode. A real radio group, so arrow keys work and the value posts with the form
 * without any JavaScript of ours.
 */
export function RatingInput({
  name,
  defaultValue = 0,
  onChange,
  className,
}: {
  name: string;
  defaultValue?: number;
  onChange?: (value: number) => void;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;

  return (
    <fieldset className={cn("border-0 p-0", className)}>
      <legend className="sr-only-live">Rating out of 5</legend>
      <div className="inline-flex items-center gap-0.5" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <label
            key={star}
            className="cursor-pointer rounded p-0.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600"
            onMouseEnter={() => setHovered(star)}
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => {
                setValue(star);
                onChange?.(star);
              }}
              className="sr-only-live"
            />
            <span className="sr-only-live">{star} stars</span>
            <Star fill={shown >= star ? 1 : 0} className="size-7" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
