"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { formatPeso } from "@/lib/utils/money";

interface Suggestion {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  priceCents: number;
}

/**
 * Search with autocomplete.
 *
 * Implements the ARIA combobox pattern: arrow keys move through suggestions, Enter opens the
 * highlighted one, Escape closes the list, and the active option is announced through
 * aria-activedescendant. A div-of-results with a click handler looks the same and is unusable
 * without a mouse.
 */
export function SearchBox({ initialTerm = "" }: { initialTerm?: string }) {
  const router = useRouter();
  const listId = useId();

  const [term, setTerm] = useState(initialTerm);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }

    /**
     * Debounced, and every in-flight request is abortable.
     *
     * Without the abort, a slow response for "bar" can land after the response for "barako"
     * and repopulate the list with stale results — the classic autocomplete race.
     */
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { data: Suggestion[] };
        setResults(payload.data);
        setOpen(true);
        setActive(-1);
      } catch {
        // Aborted or offline. Leaving the previous results up is better than clearing them.
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  // Close when focus or a click leaves the whole widget.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function go(slug?: string) {
    setOpen(false);
    if (slug) router.push(`/products/${slug}`);
    else if (term.trim()) router.push(`/products?q=${encodeURIComponent(term.trim())}`);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open || results.length === 0) {
      if (event.key === "Enter") go();
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => (i + 1) % results.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
        break;
      case "Enter":
        event.preventDefault();
        go(active >= 0 ? results[active]?.slug : undefined);
        break;
      case "Escape":
        setOpen(false);
        setActive(-1);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={boxRef} className="relative w-full md:max-w-sm">
      <label htmlFor="site-search" className="sr-only-live">
        Search products
      </label>

      <input
        id="site-search"
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Search products"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-11 w-full rounded-[var(--radius-ctrl)] border border-border-strong bg-surface px-3 text-[15px] placeholder:text-text-soft focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--color-brand-100)] focus:outline-none"
      />

      {open && results.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Product suggestions"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-96 overflow-y-auto rounded-[var(--radius-ctrl)] bg-surface py-1 shadow-[var(--shadow-raised)]"
        >
          {results.map((result, index) => (
            <li
              key={result.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // mousedown, not click: the input's blur would close the list first.
                event.preventDefault();
                go(result.slug);
              }}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
                index === active ? "bg-brand-50" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{result.name}</span>
                {result.brand ? (
                  <span className="block truncate text-xs text-text-muted">{result.brand}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-text-muted">
                {formatPeso(result.priceCents)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
