"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * docs/07 route 3, step 3 — the customer finishes it themselves.
 *
 * Behind a button rather than firing on page load: this signs out every device and moves the
 * sign-in email, and email clients and scanners follow links without being asked.
 */
export function ConfirmForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState("pending");
    setError(null);

    const response = await fetch("/api/v1/auth/recovery/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const body = await response.json();
    if (!response.ok) {
      setState("idle");
      setError(body.error?.message ?? "That link is no longer valid.");
      return;
    }

    setState("done");
  }

  if (state === "done") {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
          <p className="font-semibold">Your sign-in email has been changed</p>
          <p className="mt-1 text-sm text-text-muted">
            One step left: set a password. Use “forgot password” with your new address — the link
            arrives in seconds.
          </p>
        </div>
        <Link
          href="/forgot-password"
          className="self-center text-[13px] font-semibold text-brand-600 hover:underline"
        >
          Set a password
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-ctrl)] border-l-4 border-danger bg-danger-soft px-4 py-3 text-sm"
        >
          {error}
        </div>
      ) : null}

      <Button fullWidth loading={state === "pending"} onClick={confirm}>
        Move my account to this email
      </Button>

      <p className="text-[13px] text-text-muted">
        This signs you out everywhere. Your old address is told about the change too, so if this was
        not you, whoever holds it will know.
      </p>
    </div>
  );
}
