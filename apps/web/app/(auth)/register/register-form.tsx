"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface ApiError {
  error?: { message?: string; details?: { fields?: Record<string, string> } };
}

export function RegisterForm() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFields({});
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
        phone: form.get("phone"),
        privacyAgreed: form.get("privacyAgreed") === "on",
        marketingOptIn: form.get("marketingOptIn") === "on",
      }),
    });

    setPending(false);

    if (response.ok) {
      // The same message whether or not the address was already registered — the API
      // deliberately does not say, so the form cannot either.
      setDone(true);
      return;
    }

    const body = (await response.json()) as ApiError;
    setFields(body.error?.details?.fields ?? {});
    setMessage(body.error?.message ?? "Something went wrong. Try again.");
  }

  if (done) {
    return (
      <div className="mt-6 rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 text-sm text-text-muted">
          We have sent a link to finish setting up your account. You can still browse and check out
          while you wait.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <Field id="name" label="Name" required error={fields.name}>
        <Input id="name" name="name" autoComplete="name" required error={fields.name} />
      </Field>

      <Field id="email" label="Email" required error={fields.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fields.email}
        />
      </Field>

      <Field
        id="phone"
        label="Mobile number"
        required
        hint="Used to recover your account if you lose access to your email."
        error={fields.phone}
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="09171234567"
          required
          hint="Used to recover your account if you lose access to your email."
          error={fields.phone}
        />
      </Field>

      <Field
        id="password"
        label="Password"
        required
        hint="At least 10 characters. Length matters more than symbols."
        error={fields.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters. Length matters more than symbols."
          error={fields.password}
        />
      </Field>

      {/* Two separate checkboxes, never bundled — docs/07 and the Data Privacy Act. */}
      <div className="flex flex-col gap-1">
        <Checkbox
          id="privacyAgreed"
          name="privacyAgreed"
          label="I agree to the privacy policy"
          required
        />
        {/*
          docs/07 wants this linked to the policy. The link sits beside the label rather than
          inside it: a link inside a <label> both follows the link and toggles the checkbox,
          so agreeing would be a side effect of reading what you are agreeing to.
        */}
        <Link
          href="/privacy"
          target="_blank"
          className="ml-7 text-[13px] font-semibold text-brand-600 hover:underline"
        >
          Read the privacy policy
        </Link>
      </div>
      <Checkbox
        id="marketingOptIn"
        name="marketingOptIn"
        label="Send me occasional updates about new products"
      />

      {message ? (
        <div
          role="alert"
          className="rounded-[var(--radius-ctrl)] border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm"
        >
          {message}
        </div>
      ) : null}

      <Button type="submit" fullWidth loading={pending}>
        Create account
      </Button>

      <p className="text-[13px] text-text-muted">
        By creating an account you agree to our{" "}
        <Link href="/terms" className="font-semibold text-brand-600 hover:underline">
          terms
        </Link>
        .
      </p>
    </form>
  );
}
