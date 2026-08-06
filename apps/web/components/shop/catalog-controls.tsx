"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Sheet } from "@/components/ui/modal";
import { toCents, toPesos } from "@/lib/utils/money";

/**
 * Filters and sort, held entirely in the URL.
 *
 * Every control writes to the query string and the server reads it back. That is what makes
 * a filtered view survive a refresh, work in a shared link, and respond to the back button —
 * the P2-01 criterion. Holding this in React state instead would break all three, and the
 * breakage is invisible until someone tries to send a colleague a link.
 */

export interface Bounds {
  minCents: number;
  maxCents: number;
}

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "popular", label: "Most popular" },
] as const;

function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Applies changes and always returns to page 1 — staying on page 7 of a new filter is a bug. */
  function apply(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return { apply, searchParams, pathname };
}

export function SortSelect() {
  const { apply, searchParams } = useUrlState();
  const current = searchParams.get("sort") ?? "newest";

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="whitespace-nowrap text-[13px] text-text-muted">
        Sort
      </label>
      <Select
        id="sort"
        value={current}
        onChange={(event) => apply({ sort: event.target.value })}
        className="h-11 w-48"
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function FilterFields({ bounds }: { bounds: Bounds }) {
  const { apply, searchParams } = useUrlState();

  const [min, setMin] = useState(searchParams.get("minPrice") ?? "");
  const [max, setMax] = useState(searchParams.get("maxPrice") ?? "");
  const inStock = searchParams.get("inStock") === "true";

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="border-0 p-0">
        <legend className="mb-2 text-[13px] font-semibold text-text-muted">Price</legend>
        <div className="flex items-end gap-2">
          <Field id="minPrice" label="From">
            <Input
              id="minPrice"
              inputMode="decimal"
              prefix="₱"
              placeholder={String(toPesos(bounds.minCents))}
              value={min}
              onChange={(event) => setMin(event.target.value)}
            />
          </Field>
          <Field id="maxPrice" label="To">
            <Input
              id="maxPrice"
              inputMode="decimal"
              prefix="₱"
              placeholder={String(toPesos(bounds.maxCents))}
              value={max}
              onChange={(event) => setMax(event.target.value)}
            />
          </Field>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() =>
            apply({
              // Stored in the URL as centavos, so the server never parses a decimal.
              minPrice: min ? String(toCents(Number(min) || 0)) : null,
              maxPrice: max ? String(toCents(Number(max) || 0)) : null,
            })
          }
        >
          Apply price
        </Button>
      </fieldset>

      <Checkbox
        id="inStock"
        label="In stock only"
        checked={inStock}
        onChange={(event) => apply({ inStock: event.target.checked ? "true" : null })}
      />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setMin("");
          setMax("");
          apply({ minPrice: null, maxPrice: null, inStock: null, q: null });
        }}
      >
        Clear filters
      </Button>
    </div>
  );
}

/** Filter rail on desktop, filter sheet on mobile — docs/05. */
export function CatalogFilters({ bounds }: { bounds: Bounds }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="lg:hidden">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Filters
        </Button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Filters" side="bottom">
          <FilterFields bounds={bounds} />
        </Sheet>
      </div>

      <aside aria-label="Filters" className="hidden w-56 shrink-0 lg:block">
        <FilterFields bounds={bounds} />
      </aside>
    </>
  );
}
