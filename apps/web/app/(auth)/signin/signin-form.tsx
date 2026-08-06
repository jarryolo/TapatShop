"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** The callback error Auth.js appends when the OAuth linking rules refuse a sign-in. */
const ERROR_MESSAGES: Record<string, string> = {
  "verify-email-first":
    "An account already uses this email. Verify that address from the email we sent, then sign in with Google.",
  CredentialsSignin: "That email and password do not match.",
  Configuration: "Sign-in is not configured correctly. Try again shortly.",
};

export function SignInForm({
  callbackUrl,
  initialError,
}: {
  callbackUrl: string;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_MESSAGES[initialError] ?? "Something went wrong. Try again.") : null
  );
  /** Set when the account signs in with a provider instead of a password. */
  const [useProviders, setUseProviders] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setUseProviders(null);

    /**
     * Ask how this account signs in before attempting a password.
     *
     * docs/07: a Google-only account must be told to use Google, not that its password is
     * wrong. Checking first is what makes that message possible — the credentials provider
     * deliberately returns one uniform failure and cannot distinguish the two.
     */
    try {
      const response = await fetch("/api/v1/auth/sign-in-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        const methods = (await response.json()) as {
          exists: boolean;
          hasPassword: boolean;
          providers: string[];
        };

        if (methods.exists && !methods.hasPassword && methods.providers.length > 0) {
          setUseProviders(methods.providers);
          setPending(false);
          return;
        }
      }
    } catch {
      // Guidance is a nicety. If it fails, fall through to a normal sign-in attempt.
    }

    const result = await signIn("credentials", { email, password, redirect: false, callbackUrl });

    setPending(false);

    if (result?.error) {
      setError("That email and password do not match.");
      return;
    }

    window.location.href = result?.url ?? callbackUrl;
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <Button
        variant="secondary"
        fullWidth
        onClick={() => void signIn("google", { callbackUrl })}
        type="button"
      >
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-[13px] text-text-soft">
        <span className="h-px flex-1 bg-border-subtle" />
        or
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field id="email" label="Email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field id="password" label="Password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {useProviders ? (
          <div
            role="status"
            className="rounded-[var(--radius-ctrl)] border-l-4 border-brand-600 bg-brand-50 px-3 py-2 text-sm"
          >
            This account signs in with {useProviders.join(" or ")}. Use the button above.
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-[var(--radius-ctrl)] border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm"
          >
            {error}
          </div>
        ) : null}

        <Button type="submit" fullWidth loading={pending}>
          Sign in
        </Button>
      </form>

      <Link
        href="/forgot-password"
        className="self-center text-[13px] font-semibold text-brand-600 hover:underline"
      >
        Forgot your password?
      </Link>
    </div>
  );
}
