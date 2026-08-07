"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";

/**
 * The erasure request form.
 *
 * Two deliberate frictions: the terms are shown in full above the button, and the button is
 * only enabled after an explicit tick. This is irreversible and it takes their order history
 * with it in readable form — a one-click version would be a trap, not a convenience.
 */
export function DeletionForm({ alreadyPending }: { alreadyPending: boolean }) {
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [state, setState] = useState<"idle" | "pending" | "done">(alreadyPending ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("pending");
    setError(null);

    const response = await fetch("/api/v1/me/deletion-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });

    const body = await response.json();
    if (!response.ok) {
      setState("idle");
      setError(body.error?.message ?? "Could not file that request.");
      return;
    }

    setState("done");
  }

  if (state === "done") {
    return (
      <div className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
        <p className="font-semibold">Your request is with us</p>
        <p className="mt-1 text-sm text-text-muted">
          Someone will check whether you have an order still in transit, then carry it out. You will
          get an email confirming it — sent before your address is removed, since afterwards we
          cannot reach you.
        </p>
        <p className="mt-2 text-sm text-text-muted">
          Changed your mind? Reply to any of our emails and we will cancel the request.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      <Field
        id="reason"
        label="Anything you want to tell us?"
        hint="Optional, and it will not change the outcome."
      >
        <Textarea
          id="reason"
          rows={3}
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={understood}
          onChange={(event) => setUnderstood(event.target.checked)}
        />
        <span>
          I understand this cannot be undone, and that my past orders stay on record with my
          personal details removed.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="danger" disabled={!understood} loading={state === "pending"}>
          Request erasure
        </Button>
        <Link href="/privacy" className="text-[13px] text-text-muted hover:underline">
          Read the privacy policy first
        </Link>
      </div>
    </form>
  );
}
