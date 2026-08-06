"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";

export interface Facets {
  actors: { id: string; name: string; role: string }[];
  entities: string[];
  actions: string[];
}

/**
 * Filters in the URL, not in component state.
 *
 * An admin who has narrowed the log to one person on one day usually wants to send that view
 * to someone else. Keeping it in the query string makes the link do that, and makes the back
 * button behave.
 */
export function AuditFilters({ facets }: { facets: Facets }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to a filter invalidates the page cursor.
    next.delete("cursor");
    router.push(`${pathname}?${next}`);
  }

  const active = ["actorId", "entity", "action", "from", "to", "q"].some((key) => params.get(key));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field id="actorId" label="Who">
        <Select
          id="actorId"
          value={params.get("actorId") ?? ""}
          onChange={(event) => set("actorId", event.target.value)}
        >
          <option value="">Anyone</option>
          {facets.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name} ({actor.role})
            </option>
          ))}
        </Select>
      </Field>

      <Field id="entity" label="What">
        <Select
          id="entity"
          value={params.get("entity") ?? ""}
          onChange={(event) => set("entity", event.target.value)}
        >
          <option value="">Anything</option>
          {facets.entities.map((entity) => (
            <option key={entity} value={entity}>
              {entity}
            </option>
          ))}
        </Select>
      </Field>

      <Field id="action" label="Action">
        <Select
          id="action"
          value={params.get("action") ?? ""}
          onChange={(event) => set("action", event.target.value)}
        >
          <option value="">Any action</option>
          {facets.actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </Select>
      </Field>

      <Field id="from" label="From" hint="Manila dates.">
        <Input
          id="from"
          type="date"
          value={params.get("from") ?? ""}
          onChange={(event) => set("from", event.target.value)}
        />
      </Field>

      <Field id="to" label="To">
        <Input
          id="to"
          type="date"
          value={params.get("to") ?? ""}
          onChange={(event) => set("to", event.target.value)}
        />
      </Field>

      <Field id="q" label="Record id" hint="Paste an order or product id to see its history.">
        <Input
          id="q"
          defaultValue={params.get("q") ?? ""}
          onBlur={(event) => set("q", event.target.value.trim())}
        />
      </Field>

      {active ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
