"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";

const EMPTY = {
  claimedName: "",
  claimedEmail: "",
  claimedMemberNo: "",
  claimedOrderNo: "",
  claimedAddress: "",
  newEmail: "",
};

export function RecoveryForm() {
  const [form, setForm] = useState(EMPTY);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  function set(key: keyof typeof EMPTY) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    await fetch("/api/v1/auth/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setPending(false);
    // Same screen whatever happened. The endpoint deliberately does not say whether any of
    // this matched an account, and neither does this form.
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
          <p className="font-semibold">Request received</p>
          <p className="mt-1 text-sm text-text-muted">
            An admin will check it against the order history and email you at{" "}
            <span className="font-semibold">{form.newEmail}</span>. This is checked by a person, so
            give it a day or two.
          </p>
        </div>
        <Link
          href="/signin"
          className="self-center text-[13px] font-semibold text-brand-600 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <Field id="claimedName" label="Your full name" required>
        <Input
          id="claimedName"
          required
          autoComplete="name"
          maxLength={120}
          value={form.claimedName}
          onChange={set("claimedName")}
        />
      </Field>

      <Field
        id="newEmail"
        label="An email you can open now"
        hint="Where we send the confirmation link. This becomes your new sign-in email."
        required
      >
        <Input
          id="newEmail"
          type="email"
          required
          value={form.newEmail}
          onChange={set("newEmail")}
        />
      </Field>

      <fieldset className="mt-2 flex flex-col gap-4 border-t border-border pt-4">
        <legend className="sr-only">Proof of who you are</legend>
        <p className="text-sm text-text-muted">
          Fill in as many as you can — an admin needs at least two to match. The more you give, the
          faster this goes.
        </p>

        <Field
          id="claimedEmail"
          label="The email you used to sign in"
          hint="Even if you can no longer open it."
        >
          <Input
            id="claimedEmail"
            type="email"
            value={form.claimedEmail}
            onChange={set("claimedEmail")}
          />
        </Field>

        <Field id="claimedMemberNo" label="Member number">
          <Input
            id="claimedMemberNo"
            maxLength={40}
            value={form.claimedMemberNo}
            onChange={set("claimedMemberNo")}
          />
        </Field>

        <Field id="claimedOrderNo" label="A recent order number" hint="It looks like TS-2026-0001.">
          <Input
            id="claimedOrderNo"
            maxLength={40}
            value={form.claimedOrderNo}
            onChange={set("claimedOrderNo")}
          />
        </Field>

        <Field id="claimedAddress" label="The delivery address on that order">
          <Textarea
            id="claimedAddress"
            rows={3}
            maxLength={300}
            value={form.claimedAddress}
            onChange={set("claimedAddress")}
          />
        </Field>
      </fieldset>

      <Button type="submit" fullWidth loading={pending}>
        Send request
      </Button>

      <p className="text-[13px] text-text-muted">
        Nobody at TapatShop can see or set your password — not even an admin. If this is approved
        you will set a new one yourself.
      </p>

      <Link
        href="/signin"
        className="self-center text-[13px] font-semibold text-brand-600 hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
