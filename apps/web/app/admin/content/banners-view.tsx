"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils/format";

export interface BannerRow {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
  placement: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

type Draft = Omit<BannerRow, "id"> & { id?: string };

const BLANK: Draft = {
  title: "",
  subtitle: "",
  imageUrl: "",
  linkUrl: "",
  placement: "home_hero",
  sortOrder: 0,
  isActive: true,
  startsAt: null,
  endsAt: null,
};

const PLACEMENT_LABEL: Record<string, string> = {
  home_hero: "Home hero",
  home_secondary: "Home, below the hero",
  category_top: "Top of a category",
};

/** Why a banner is not showing right now, or null if it is. */
function dormancy(banner: BannerRow, now: Date): string | null {
  if (!banner.isActive) return "Off";
  if (banner.startsAt && new Date(banner.startsAt) > now) return "Scheduled";
  if (banner.endsAt && new Date(banner.endsAt) < now) return "Ended";
  return null;
}

export function BannersView({ rows }: { rows: BannerRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);
  const now = new Date();

  async function remove(banner: BannerRow) {
    if (!window.confirm(`Delete "${banner.title}"? Nothing links to it, so this is final.`)) return;

    const response = await fetch(`/api/v1/admin/content/banners/${banner.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      toast("Could not delete that banner.", "error");
      return;
    }

    toast("Banner deleted.", "success");
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Banners</CardTitle>
          <Button size="sm" onClick={() => setEditing({ ...BLANK })}>
            New banner
          </Button>
        </CardHeader>

        {rows.length === 0 ? (
          <EmptyState
            title="No banners yet"
            body="A hero banner sits at the top of the home page."
          />
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {rows.map((banner) => {
              const reason = dormancy(banner, now);

              return (
                <li key={banner.id} className="flex flex-wrap items-center gap-3 py-3">
                  {/* The image itself, not a filename — the point of a banner is how it looks. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={banner.imageUrl}
                    alt=""
                    className="h-12 w-20 shrink-0 rounded-[var(--radius-ctrl)] object-cover"
                  />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{banner.title}</span>
                    <span className="block truncate text-[13px] text-text-muted">
                      {PLACEMENT_LABEL[banner.placement] ?? banner.placement}
                      {banner.startsAt ? ` · from ${formatDate(banner.startsAt)}` : ""}
                      {banner.endsAt ? ` · to ${formatDate(banner.endsAt)}` : ""}
                    </span>
                  </span>

                  {reason ? <Badge>{reason}</Badge> : <Badge tone="success">Showing</Badge>}

                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setEditing({
                          ...banner,
                          subtitle: banner.subtitle ?? "",
                          linkUrl: banner.linkUrl ?? "",
                          startsAt: banner.startsAt?.slice(0, 16) ?? null,
                          endsAt: banner.endsAt?.slice(0, 16) ?? null,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(banner)}>
                      Delete
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing ? (
        <BannerForm
          key={editing.id ?? "new"}
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function BannerForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(draft);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const response = await fetch(
      form.id ? `/api/v1/admin/content/banners/${form.id}` : "/api/v1/admin/content/banners",
      {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          subtitle: form.subtitle || null,
          linkUrl: form.linkUrl || null,
          startsAt: form.startsAt || null,
          endsAt: form.endsAt || null,
        }),
      }
    );
    setPending(false);

    const body = await response.json();
    if (!response.ok) {
      const fields = body.error?.details?.fields as Record<string, string> | undefined;
      if (fields) setErrors(fields);
      else toast(body.error?.message ?? "Could not save that banner.", "error");
      return;
    }

    toast(form.id ? "Banner saved." : "Banner created.", "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={form.id ? "Edit banner" : "New banner"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field id="title" label="Title" error={errors.title} required>
          <Input
            id="title"
            required
            maxLength={200}
            value={form.title}
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>

        <Field id="subtitle" label="Subtitle" error={errors.subtitle}>
          <Input
            id="subtitle"
            maxLength={300}
            value={form.subtitle ?? ""}
            onChange={(event) => set("subtitle", event.target.value)}
          />
        </Field>

        <Field
          id="imageUrl"
          label="Image URL"
          hint="Images go to S3-compatible storage, never the repo."
          error={errors.imageUrl}
          required
        >
          <Input
            id="imageUrl"
            required
            value={form.imageUrl}
            onChange={(event) => set("imageUrl", event.target.value)}
          />
        </Field>

        <Field id="linkUrl" label="Links to" hint="Where clicking it goes. Blank for nowhere.">
          <Input
            id="linkUrl"
            value={form.linkUrl ?? ""}
            onChange={(event) => set("linkUrl", event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="placement" label="Placement" required>
            <Select
              id="placement"
              value={form.placement}
              onChange={(event) => set("placement", event.target.value)}
            >
              {Object.entries(PLACEMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="sortOrder" label="Order" hint="Lower shows first.">
            <Input
              id="sortOrder"
              type="number"
              min={0}
              max={999}
              value={form.sortOrder}
              onChange={(event) => set("sortOrder", Number(event.target.value) || 0)}
            />
          </Field>

          <Field id="startsAt" label="Starts" hint="Blank to show immediately.">
            <Input
              id="startsAt"
              type="datetime-local"
              value={form.startsAt ?? ""}
              onChange={(event) => set("startsAt", event.target.value || null)}
            />
          </Field>

          <Field id="endsAt" label="Ends" hint="Blank to run forever." error={errors.endsAt}>
            <Input
              id="endsAt"
              type="datetime-local"
              value={form.endsAt ?? ""}
              onChange={(event) => set("endsAt", event.target.value || null)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set("isActive", event.target.checked)}
          />
          Active
        </label>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" loading={pending}>
            {form.id ? "Save banner" : "Create banner"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
