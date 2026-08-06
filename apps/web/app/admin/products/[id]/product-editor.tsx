"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatPeso, toCents, toPesos } from "@/lib/utils/money";

interface VariantRow {
  id?: string;
  sku: string;
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stockQty?: number;
  weightGrams: number;
  isActive: boolean;
}

interface ImageRow {
  id: string;
  url: string;
  alt: string | null;
}

interface ProductState {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  description: string | null;
  status: "draft" | "active" | "archived";
  categoryId: string | null;
  isFeatured: boolean;
  memberOnly: boolean;
  variants: VariantRow[];
  images: ImageRow[];
}

interface Blocker {
  field: string;
  message: string;
}

export function ProductEditor({
  product,
  categories,
  initialBlockers,
}: {
  product: ProductState;
  categories: { id: string; name: string }[];
  initialBlockers: Blocker[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [details, setDetails] = useState(product);
  const [variants, setVariants] = useState<VariantRow[]>(product.variants);
  const [images, setImages] = useState<ImageRow[]>(product.images);
  const [blockers, setBlockers] = useState<Blocker[]>(initialBlockers);
  const [saving, setSaving] = useState<string | null>(null);

  async function call(url: string, method: string, body: unknown) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, payload };
  }

  async function saveDetails() {
    setSaving("details");
    const { ok, payload } = await call(`/api/v1/admin/products/${product.id}`, "PATCH", {
      name: details.name,
      brand: details.brand,
      description: details.description,
      categoryId: details.categoryId,
      isFeatured: details.isFeatured,
      memberOnly: details.memberOnly,
    });
    setSaving(null);

    if (!ok) {
      toast(payload.error?.message ?? "Could not save.", "error");
      return;
    }
    toast("Saved.", "success");
    router.refresh();
  }

  async function saveVariants() {
    setSaving("variants");
    const { ok, payload } = await call(`/api/v1/admin/products/${product.id}/variants`, "POST", {
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        priceCents: v.priceCents,
        compareAtPriceCents: v.compareAtPriceCents,
        weightGrams: v.weightGrams,
        isActive: v.isActive,
      })),
    });
    setSaving(null);

    if (!ok) {
      // Names the offending SKUs rather than a database constraint.
      toast(payload.error?.message ?? "Could not save the variants.", "error");
      return;
    }
    toast("Variants saved.", "success");
    router.refresh();
  }

  async function setStatus(status: "active" | "draft" | "archived") {
    setSaving("status");
    const { ok, payload } = await call(`/api/v1/admin/products/${product.id}`, "PATCH", { status });
    setSaving(null);

    if (!ok) {
      const problems: Blocker[] = payload.error?.details?.publishBlockers ?? [];
      setBlockers(problems);
      toast(payload.error?.message ?? "Could not change the status.", "error");
      return;
    }

    setBlockers([]);
    setDetails((d) => ({ ...d, status }));
    toast(status === "active" ? "Published." : `Moved to ${status}.`, "success");
    router.refresh();
  }

  /**
   * Keyboard-accessible reordering.
   *
   * Buttons rather than only drag-and-drop: dragging is impossible with a keyboard and
   * awkward on a phone, and docs/05 requires every interactive element be reachable by
   * keyboard. The pointer affordance can be layered on top later without changing this.
   */
  async function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const next = [...images];
    const moved = next[index];
    const other = next[target];
    if (!moved || !other) return;
    next[index] = other;
    next[target] = moved;
    setImages(next);

    const { ok } = await call(`/api/v1/admin/products/${product.id}/images`, "PATCH", {
      imageIds: next.map((i) => i.id),
    });
    if (!ok) toast("Could not save the new order.", "error");
    else router.refresh();
  }

  async function saveAlt(image: ImageRow, alt: string) {
    const { ok } = await call(`/api/v1/admin/products/${product.id}/images`, "PATCH", {
      imageId: image.id,
      alt,
    });
    if (!ok) toast("Could not save the alt text.", "error");
    else router.refresh();
  }

  function updateVariant(index: number, patch: Partial<VariantRow>) {
    setVariants((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">{details.name}</h1>
          <p className="mt-1 text-sm text-text-muted">/{details.slug}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge
            tone={
              details.status === "active"
                ? "success"
                : details.status === "archived"
                  ? "warning"
                  : "neutral"
            }
          >
            {details.status}
          </Badge>

          {details.status === "active" ? (
            <Button
              variant="secondary"
              onClick={() => setStatus("draft")}
              loading={saving === "status"}
            >
              Unpublish
            </Button>
          ) : (
            <Button onClick={() => setStatus("active")} loading={saving === "status"}>
              Publish
            </Button>
          )}
        </div>
      </header>

      {blockers.length > 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-card)] border-l-4 border-warning bg-warning-soft px-4 py-3"
        >
          <p className="font-semibold">Not ready to publish</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {blockers.map((blocker) => (
              <li key={`${blocker.field}-${blocker.message}`}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <Field id="name" label="Name" required>
            <Input
              id="name"
              value={details.name}
              onChange={(e) => setDetails({ ...details, name: e.target.value })}
            />
          </Field>

          <Field id="brand" label="Brand">
            <Input
              id="brand"
              value={details.brand ?? ""}
              onChange={(e) => setDetails({ ...details, brand: e.target.value })}
            />
          </Field>

          <Field id="categoryId" label="Category">
            <Select
              id="categoryId"
              value={details.categoryId ?? ""}
              onChange={(e) => setDetails({ ...details, categoryId: e.target.value || null })}
            >
              <option value="">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex flex-col justify-end gap-1">
            <Checkbox
              id="isFeatured"
              label="Featured on the home page"
              checked={details.isFeatured}
              onChange={(e) => setDetails({ ...details, isFeatured: e.target.checked })}
            />
            <Checkbox
              id="memberOnly"
              label="Members only"
              hint="Controls visibility, not price."
              checked={details.memberOnly}
              onChange={(e) => setDetails({ ...details, memberOnly: e.target.checked })}
            />
          </div>

          <div className="md:col-span-2">
            <Field id="description" label="Description" required>
              <Textarea
                id="description"
                rows={5}
                value={details.description ?? ""}
                onChange={(e) => setDetails({ ...details, description: e.target.value })}
              />
            </Field>
          </div>
        </div>

        <div className="mt-4">
          <Button onClick={saveDetails} loading={saving === "details"}>
            Save details
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variants</CardTitle>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setVariants([
                ...variants,
                {
                  sku: "",
                  name: variants.length === 0 ? "Default" : "",
                  priceCents: 0,
                  compareAtPriceCents: null,
                  weightGrams: 0,
                  isActive: true,
                },
              ])
            }
          >
            Add variant
          </Button>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-[13px] text-text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  SKU
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Name
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Price
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Compare at
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Weight (g)
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Stock
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Active
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant, index) => (
                <tr
                  key={variant.id ?? `new-${index}`}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="py-2 pr-3">
                    <input
                      aria-label={`SKU for variant ${index + 1}`}
                      className="w-36 rounded-[var(--radius-ctrl)] border border-border-strong px-2 py-1.5"
                      value={variant.sku}
                      onChange={(e) => updateVariant(index, { sku: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      aria-label={`Name for variant ${index + 1}`}
                      className="w-40 rounded-[var(--radius-ctrl)] border border-border-strong px-2 py-1.5"
                      value={variant.name}
                      onChange={(e) => updateVariant(index, { name: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {/* Entered in pesos, stored in centavos — the conversion happens here and
                        nowhere else, so no component ever holds a float price. */}
                    <input
                      aria-label={`Price for variant ${index + 1}`}
                      inputMode="decimal"
                      className="w-28 rounded-[var(--radius-ctrl)] border border-border-strong px-2 py-1.5 text-right"
                      value={toPesos(variant.priceCents)}
                      onChange={(e) =>
                        updateVariant(index, { priceCents: toCents(Number(e.target.value) || 0) })
                      }
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      aria-label={`Compare at price for variant ${index + 1}`}
                      inputMode="decimal"
                      className="w-28 rounded-[var(--radius-ctrl)] border border-border-strong px-2 py-1.5 text-right"
                      value={
                        variant.compareAtPriceCents ? toPesos(variant.compareAtPriceCents) : ""
                      }
                      onChange={(e) =>
                        updateVariant(index, {
                          compareAtPriceCents: e.target.value
                            ? toCents(Number(e.target.value) || 0)
                            : null,
                        })
                      }
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      aria-label={`Weight for variant ${index + 1}`}
                      inputMode="numeric"
                      className="w-24 rounded-[var(--radius-ctrl)] border border-border-strong px-2 py-1.5 text-right"
                      value={variant.weightGrams}
                      onChange={(e) =>
                        updateVariant(index, { weightGrams: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-text-muted">
                    {/* Read-only. Stock moves only through inventory movements — docs/CLAUDE.md. */}
                    {variant.stockQty ?? 0}
                  </td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      aria-label={`Variant ${index + 1} is active`}
                      checked={variant.isActive}
                      onChange={(e) => updateVariant(index, { isActive: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {variants.length === 0 ? (
          <p className="py-4 text-sm text-text-muted">
            No variants yet. A product with no options still needs one, named Default.
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={saveVariants}
            loading={saving === "variants"}
            disabled={variants.length === 0}
          >
            Save variants
          </Button>
          <span className="text-[13px] text-text-muted">
            Stock is adjusted from Inventory, not here.
          </span>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
        </CardHeader>

        {images.length === 0 ? (
          <p className="text-sm text-text-muted">
            No images yet. Uploading arrives with the media pipeline in P1-06 — it needs the object
            storage that is not running yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {images.map((image, index) => (
              <li
                key={image.id}
                className="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-3 last:border-0"
              >
                <span className="w-16 shrink-0 text-[13px] font-semibold text-text-muted">
                  {index === 0 ? "Primary" : `#${index + 1}`}
                </span>

                <span className="min-w-0 flex-1 truncate text-[13px] text-text-muted">
                  {image.url}
                </span>

                <input
                  aria-label={`Alt text for image ${index + 1}`}
                  placeholder="Describe what the image shows"
                  className="min-w-48 flex-1 rounded-[var(--radius-ctrl)] border border-border-strong px-2 py-1.5 text-sm"
                  defaultValue={image.alt ?? ""}
                  onBlur={(e) => void saveAlt(image, e.target.value)}
                />

                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move image ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => void moveImage(index, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move image ${index + 1} down`}
                    disabled={index === images.length - 1}
                    onClick={() => void moveImage(index, 1)}
                  >
                    Down
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <p className="text-sm text-text-muted">
          Archiving hides the product from the storefront and keeps every order, movement and audit
          row intact. Products are never deleted.
        </p>
        <div className="mt-4">
          <Button
            variant="danger"
            onClick={() => setStatus("archived")}
            loading={saving === "status"}
          >
            Archive product
          </Button>
        </div>
      </Card>

      <p className="text-[13px] text-text-soft">
        Lowest active price:{" "}
        {formatPeso(Math.min(...variants.filter((v) => v.isActive).map((v) => v.priceCents), 0))}
      </p>
    </div>
  );
}
