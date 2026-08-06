"use client";

import { type ReactNode, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Tabs with the keyboard behaviour the ARIA pattern specifies: arrow keys move between
 * tabs, Home and End jump to the ends, and only the active tab is in the tab order. Without
 * the roving tabindex, tabbing through a five-tab product page means five stops before the
 * content.
 */
export function Tabs({
  items,
  defaultId,
  className,
}: {
  items: TabItem[];
  defaultId?: string;
  className?: string;
}) {
  const baseId = useId();
  const first = items[0];
  const [active, setActive] = useState(defaultId ?? first?.id ?? "");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  if (items.length === 0) return null;

  const focusTab = (index: number) => {
    const wrapped = (index + items.length) % items.length;
    const target = items[wrapped];
    if (!target) return;
    setActive(target.id);
    tabRefs.current[target.id]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(items.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 border-b border-border-subtle">
        {items.map((item, index) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "-mb-px min-h-11 border-b-2 px-4 text-[15px] font-semibold transition-colors duration-150",
                selected
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-text-muted hover:border-border-strong hover:text-text"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="py-4"
        >
          {item.id === active ? item.content : null}
        </div>
      ))}
    </div>
  );
}
