"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    await fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setPending(false);
    // Shown regardless of the outcome. The endpoint does not tell us whether the address
    // exists, and this screen must not imply it either.
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
          <p className="font-semibold">Check your email</p>
          <p className="mt-1 text-sm text-text-muted">
            If that email has an account, we have sent a link to reset the password.
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
      <Field id="email" label="Email" required>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Button type="submit" fullWidth loading={pending}>
        Send reset link
      </Button>

      <Link
        href="/signin"
        className="self-center text-[13px] font-semibold text-brand-600 hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
