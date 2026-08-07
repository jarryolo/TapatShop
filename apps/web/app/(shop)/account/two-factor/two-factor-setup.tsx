"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

interface Status {
  enabled: boolean;
  required: boolean;
  remainingCodes: number;
}

export function TwoFactorSetup({ initial }: { initial: Status }) {
  const router = useRouter();
  const { toast } = useToast();
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setPending(true);
    setError(null);

    const response = await fetch("/api/v1/me/two-factor", { method: "POST" });
    const body = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(body.error?.message ?? "Could not start setup.");
      return;
    }

    setSecret(body.data);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/v1/me/two-factor", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(body.error?.message ?? "Could not confirm that code.");
      return;
    }

    setCodes(body.data.recoveryCodes);
    toast("Two-factor is on.", "success");
    router.refresh();
  }

  /**
   * Shown once, and only here.
   *
   * The codes are stored hashed, so there is no screen that can show them again. Saying so
   * plainly is the difference between someone copying them now and someone assuming they can
   * come back for them.
   */
  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-ctrl)] border-l-4 border-success bg-success-soft px-4 py-3">
          <p className="font-semibold">Two-factor is on</p>
          <p className="mt-1 text-sm text-text-muted">
            Save these recovery codes somewhere that is not your phone. Each one works once, and
            this is the only time they can be shown — they are stored hashed.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-2 rounded-[var(--radius-ctrl)] bg-surface-sunken p-4 font-mono text-sm">
          {codes.map((entry) => (
            <li key={entry} className="tabular-nums">
              {entry}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(codes.join("\n"));
              toast("Copied.", "success");
            }}
          >
            Copy codes
          </Button>
          <Link
            href="/admin"
            className="rounded-[var(--radius-ctrl)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            I have saved them — go to the admin
          </Link>
        </div>
      </div>
    );
  }

  if (initial.enabled) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm">
          <Badge tone="success">On</Badge>
          <span className="text-text-muted">
            {initial.remainingCodes} recovery {initial.remainingCodes === 1 ? "code" : "codes"}{" "}
            left.
          </span>
        </p>
        {initial.remainingCodes <= 2 ? (
          <p className="rounded-[var(--radius-ctrl)] border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
            Running low on recovery codes. Reset two-factor to get a fresh set — you will need to
            scan the new code into your app.
          </p>
        ) : null}
        <p className="text-[13px] text-text-muted">
          Changing phones? Reset it from here and scan the new code.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {initial.required ? (
        <p className="rounded-[var(--radius-ctrl)] border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
          Your account can reach the admin, so two-factor is required. You will not be able to open
          the admin until this is set up.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {!secret ? (
        <div>
          <p className="text-sm text-text-muted">
            You will need an authenticator app — Google Authenticator, 1Password, Aegis, or any
            other. They all work the same way.
          </p>
          <Button className="mt-3" loading={pending} onClick={begin}>
            Start setup
          </Button>
        </div>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold">1. Add this to your authenticator app</p>
            <p className="mt-1 text-sm text-text-muted">
              Most apps offer &ldquo;enter a setup key&rdquo;. Type the key below, or open the link
              on the same device.
            </p>
            <p className="mt-2 break-all rounded-[var(--radius-ctrl)] bg-surface-sunken px-4 py-3 font-mono text-sm">
              {secret.secret}
            </p>
            <a
              href={secret.uri}
              className="mt-2 inline-block text-[13px] font-semibold text-brand-600 hover:underline"
            >
              Open in an authenticator app
            </a>
          </div>

          <Field
            id="code"
            label="2. Enter the six-digit code it shows"
            hint="This proves the app is set up before we turn anything on."
            required
          >
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>

          <Button type="submit" loading={pending} className="self-start">
            Turn on two-factor
          </Button>
        </form>
      )}
    </div>
  );
}
