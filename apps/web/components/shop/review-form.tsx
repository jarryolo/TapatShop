"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";

export type ReviewGate =
  "ok" | "signed_out" | "not_purchased" | "email_unverified" | "already_reviewed";

/**
 * The review form, or the reason there isn't one.
 *
 * Every reason is stated plainly. "Only verified purchasers can review" shown to someone who
 * did buy the thing, with no way to tell which rule they tripped, is the version of this that
 * generates support mail.
 */
export function ReviewForm({ productId, gate }: { productId: string; gate: ReviewGate }) {
  const [rating, setRating] = useState(0);
  const [form, setForm] = useState({ title: "", body: "" });
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (gate === "signed_out") {
    return (
      <p className="text-[15px] text-text-muted">
        <Link href="/signin" className="font-semibold text-brand-600 hover:underline">
          Sign in
        </Link>{" "}
        to review something you have bought.
      </p>
    );
  }

  if (gate === "not_purchased") {
    return (
      <p className="text-[15px] text-text-muted">
        Reviews are for people who have bought the product.
      </p>
    );
  }

  if (gate === "email_unverified") {
    return (
      <p className="text-[15px] text-text-muted">
        Verify your email address before leaving a review. Check your inbox for the link.
      </p>
    );
  }

  if (gate === "already_reviewed") {
    return <p className="text-[15px] text-text-muted">You have already reviewed this product.</p>;
  }

  if (state === "done") {
    return (
      <div className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
        <p className="font-semibold">Thank you</p>
        <p className="mt-1 text-sm text-text-muted">
          Your review will appear once someone has read it.
        </p>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (rating === 0) {
      setError("Pick a rating.");
      return;
    }

    setState("pending");
    setError(null);

    const response = await fetch("/api/v1/me/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        rating,
        title: form.title || undefined,
        body: form.body || undefined,
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      setState("idle");
      setError(body.error?.message ?? "Could not save that review.");
      return;
    }

    setState("done");
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      <fieldset>
        <legend className="text-sm font-semibold">Your rating</legend>
        {/* Radios rather than clickable stars: a star widget with no keyboard path is
            unusable for anyone not holding a mouse. Styled as stars, still a radio group. */}
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <label
              key={star}
              className={
                star <= rating
                  ? "cursor-pointer rounded px-2 py-1 text-2xl text-warning-strong"
                  : "cursor-pointer rounded px-2 py-1 text-2xl text-text-soft"
              }
            >
              <input
                type="radio"
                name="rating"
                value={star}
                checked={rating === star}
                onChange={() => setRating(star)}
                className="sr-only"
              />
              <span aria-hidden="true">★</span>
              <span className="sr-only">
                {star} {star === 1 ? "star" : "stars"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      <Field id="review-title" label="Headline" hint="Optional.">
        <Input
          id="review-title"
          maxLength={120}
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </Field>

      <Field id="review-body" label="Your review" hint="Optional. What would you tell a brother?">
        <Textarea
          id="review-body"
          rows={4}
          maxLength={4000}
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
        />
      </Field>

      <Button type="submit" loading={state === "pending"} className="self-start">
        Submit review
      </Button>

      <p className="text-[13px] text-text-muted">Reviews are read by someone before they appear.</p>
    </form>
  );
}
