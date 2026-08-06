"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface ApiError {
  error?: { message?: string; details?: { fields?: Record<string, string> } };
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/v1/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });

    setPending(false);

    if (response.ok) {
      setDone(true);
      return;
    }

    const body = (await response.json()) as ApiError;
    setError(body.error?.message ?? "Something went wrong. Try again.");
  }

  if (done) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
          <p className="font-semibold">Password changed</p>
          <p className="mt-1 text-sm text-text-muted">
            Sign in with your new password. Any other devices have been signed out.
          </p>
        </div>
        <Link href="/signin" className="self-center font-semibold text-brand-600 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <Field
        id="newPassword"
        label="New password"
        required
        hint="At least 10 characters. Length matters more than symbols."
        error={error ?? undefined}
      >
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint="At least 10 characters. Length matters more than symbols."
          error={error ?? undefined}
        />
      </Field>

      <Button type="submit" fullWidth loading={pending}>
        Change password
      </Button>
    </form>
  );
}
