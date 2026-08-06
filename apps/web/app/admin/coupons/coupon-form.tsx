"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

export interface CouponDraft {
  id?: string;
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  percentage: number | null;
  valueCents: number | null;
  minSubtotalCents: number;
  maxUses: number | null;
  maxUsesPerUser: number;
  membersOnly: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

export const BLANK: CouponDraft = {
  code: "",
  type: "percentage",
  percentage: 10,
  valueCents: null,
  minSubtotalCents: 0,
  maxUses: null,
  maxUsesPerUser: 1,
  membersOnly: false,
  startsAt: null,
  endsAt: null,
  isActive: true,
};

/** Pesos in the form, centavos on the wire. The conversion happens in exactly these two spots. */
const toPesos = (cents: number | null) => (cents === null ? "" : String(cents / 100));
const toCents = (pesos: string) => Math.round(Number(pesos) * 100);

export function CouponForm({
  open,
  draft,
  onClose,
}: {
  open: boolean;
  draft: CouponDraft;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState(draft);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const body = {
      code: form.code,
      type: form.type,
      percentage: form.type === "percentage" ? form.percentage : null,
      valueCents: form.type === "fixed" ? form.valueCents : null,
      minSubtotalCents: form.minSubtotalCents,
      maxUses: form.maxUses,
      maxUsesPerUser: form.maxUsesPerUser,
      membersOnly: form.membersOnly,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      isActive: form.isActive,
    };

    const response = await fetch(
      form.id ? `/api/v1/admin/coupons/${form.id}` : "/api/v1/admin/coupons",
      {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setPending(false);

    const payload = await response.json();
    if (!response.ok) {
      // Field errors land on their fields; anything else goes to a toast.
      const fields = payload.error?.details?.fields as Record<string, string> | undefined;
      if (fields) setErrors(fields);
      else toast(payload.error?.message ?? "Could not save that coupon.", "error");
      return;
    }

    toast(form.id ? "Coupon saved." : "Coupon created.", "success");
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? "Edit coupon" : "New coupon"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="code"
            label="Code"
            hint="What the customer types."
            error={errors.code}
            required
          >
            <Input
              id="code"
              required
              maxLength={40}
              value={form.code}
              // Upper-cased as they type, so the field shows what the server will store.
              onChange={(event) => set("code", event.target.value.toUpperCase())}
            />
          </Field>

          <Field id="type" label="Discount type" required>
            <Select
              id="type"
              value={form.type}
              onChange={(event) => set("type", event.target.value as CouponDraft["type"])}
            >
              <option value="percentage">Percentage off</option>
              <option value="fixed">Fixed amount off</option>
              <option value="free_shipping">Free shipping</option>
            </Select>
          </Field>

          {form.type === "percentage" ? (
            <Field id="percentage" label="Percent off" error={errors.percentage} required>
              <Input
                id="percentage"
                type="number"
                min={1}
                max={100}
                required
                value={form.percentage ?? ""}
                onChange={(event) => set("percentage", Number(event.target.value))}
              />
            </Field>
          ) : null}

          {form.type === "fixed" ? (
            <Field id="valueCents" label="Amount off" error={errors.valueCents} required>
              <Input
                id="valueCents"
                type="number"
                min={0}
                step="0.01"
                prefix="₱"
                required
                value={toPesos(form.valueCents)}
                onChange={(event) => set("valueCents", toCents(event.target.value))}
              />
            </Field>
          ) : null}

          <Field
            id="minSubtotalCents"
            label="Minimum spend"
            hint="Leave at 0 for none."
            error={errors.minSubtotalCents}
          >
            <Input
              id="minSubtotalCents"
              type="number"
              min={0}
              step="0.01"
              prefix="₱"
              value={toPesos(form.minSubtotalCents)}
              onChange={(event) => set("minSubtotalCents", toCents(event.target.value) || 0)}
            />
          </Field>

          <Field id="maxUses" label="Total uses" hint="Blank for unlimited." error={errors.maxUses}>
            <Input
              id="maxUses"
              type="number"
              min={1}
              value={form.maxUses ?? ""}
              onChange={(event) =>
                set("maxUses", event.target.value === "" ? null : Number(event.target.value))
              }
            />
          </Field>

          <Field id="maxUsesPerUser" label="Uses per customer" error={errors.maxUsesPerUser}>
            <Input
              id="maxUsesPerUser"
              type="number"
              min={1}
              max={100}
              value={form.maxUsesPerUser}
              onChange={(event) => set("maxUsesPerUser", Number(event.target.value) || 1)}
            />
          </Field>

          <Field id="startsAt" label="Starts" hint="Blank to start now.">
            <Input
              id="startsAt"
              type="datetime-local"
              value={form.startsAt ?? ""}
              onChange={(event) => set("startsAt", event.target.value || null)}
            />
          </Field>

          <Field id="endsAt" label="Ends" hint="Blank for no end." error={errors.endsAt}>
            <Input
              id="endsAt"
              type="datetime-local"
              value={form.endsAt ?? ""}
              onChange={(event) => set("endsAt", event.target.value || null)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.membersOnly}
              onChange={(event) => set("membersOnly", event.target.checked)}
            />
            Verified members only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => set("isActive", event.target.checked)}
            />
            Active
          </label>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" loading={pending}>
            {form.id ? "Save coupon" : "Create coupon"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
