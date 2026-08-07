"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * "Tell me when this is back", on a sold-out variant.
 *
 * Shown instead of a disabled add-to-cart rather than beside it. A greyed-out button with no
 * alternative is a dead end, and this is the one thing the customer can still usefully do.
 */
export function NotifyMe({
  slug,
  variantId,
  signedInEmail,
}: {
  slug: string;
  variantId: string;
  signedInEmail?: string | null;
}) {
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("pending");
    setError(null);

    const response = await fetch(`/api/v1/products/${slug}/notify-me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId, email }),
    });

    const body = await response.json();
    if (!response.ok) {
      setState("idle");
      setError(body.error?.message ?? "Could not save that.");
      return;
    }

    setState("done");
  }

  if (state === "done") {
    return (
      <p className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3 text-sm">
        We will email you when it is back. One message, then we stop.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">Out of stock. We can tell you when it returns.</p>

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {/* A signed-in customer's address is taken from their account server-side either way,
          so there is nothing useful for them to type here. */}
      {signedInEmail ? null : (
        <Field id="notify-email" label="Email" required>
          <Input
            id="notify-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      )}

      <Button type="submit" variant="secondary" fullWidth loading={state === "pending"}>
        Tell me when it is back
      </Button>
    </form>
  );
}
