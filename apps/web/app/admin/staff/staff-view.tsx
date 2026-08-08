"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils/format";

export interface StaffRow {
  id: string;
  email: string;
  name: string | null;
  role: "customer" | "staff" | "admin";
  twoFactorEnabled: boolean;
  disabledAt: string | null;
  createdAt: string;
}

const TONES: Record<string, BadgeTone> = {
  admin: "brand",
  staff: "neutral",
  customer: "neutral",
};

export function StaffView({
  members,
  currentUserId,
}: {
  members: StaffRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [found, setFound] = useState<StaffRow | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [searching, setSearching] = useState(false);

  async function changeRole(id: string, role: StaffRow["role"]) {
    setPending(id);
    const response = await fetch(`/api/v1/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setPending(null);

    if (!response.ok) {
      // The refusals here are specific and actionable — "this is the only admin" is worth
      // reading, so the server's message is shown rather than a generic failure.
      const body = await response.json().catch(() => null);
      toast(body?.error?.message ?? "Could not change that role.", "error");
      return;
    }

    setFound(null);
    setEmail("");
    toast(`Role changed to ${role}.`, "success");
    router.refresh();
  }

  async function lookUp() {
    setSearching(true);
    setLookupError("");
    setFound(null);

    const response = await fetch(`/api/v1/admin/staff?email=${encodeURIComponent(email)}`);
    setSearching(false);

    if (!response.ok) {
      setLookupError("Could not search right now.");
      return;
    }

    const body = await response.json();
    const match = body.data?.[0] ?? null;
    if (!match) {
      // Deliberately not "no such account" — an admin needs to know the difference between a
      // typo and someone who has not registered yet, and both look the same from here.
      setLookupError("Nobody is registered with that email. They need an account first.");
      return;
    }

    setFound(match);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Give someone access</CardTitle>
        </CardHeader>

        <p className="mb-4 text-sm text-text-muted">
          Find an existing account by its exact email, then choose a role. There is no invite here
          and no password is ever set — the person registers themselves first, the same way a
          customer does.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <Field id="staff-email" label="Email address" error={lookupError}>
              <Input
                id="staff-email"
                type="email"
                autoComplete="off"
                value={email}
                error={lookupError}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void lookUp();
                }}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!email.trim() || searching}
            onClick={() => void lookUp()}
          >
            {searching ? "Searching" : "Find account"}
          </Button>
        </div>

        {found && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{found.name ?? found.email}</p>
              <p className="text-[13px] text-text-muted">
                {found.email} — currently {found.role}
              </p>
            </div>
            <RolePicker
              id={found.id}
              value={found.role}
              disabled={pending === found.id || found.id === currentUserId}
              onChange={(role) => void changeRole(found.id, role)}
            />
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="px-4 pt-4 md:px-5 md:pt-5">
          <CardTitle>Current access</CardTitle>
        </div>

        {members.length === 0 ? (
          <EmptyState title="No staff yet" body="Nobody has admin portal access apart from you." />
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {member.name ?? member.email}
                    <Badge tone={TONES[member.role] ?? "neutral"}>{member.role}</Badge>
                    {member.id === currentUserId && <Badge tone="neutral">you</Badge>}
                    {/* Staff and admins must have 2FA, so an unenrolled one cannot get in
                        at all — worth showing rather than leaving them looking locked out. */}
                    {!member.twoFactorEnabled && <Badge tone="warning">2FA not set up</Badge>}
                    {member.disabledAt && <Badge tone="neutral">disabled</Badge>}
                  </p>
                  <p className="text-[13px] text-text-muted">
                    {member.email} — added {formatDateTime(member.createdAt)}
                  </p>
                </div>

                <RolePicker
                  id={member.id}
                  value={member.role}
                  disabled={pending === member.id || member.id === currentUserId}
                  onChange={(role) => void changeRole(member.id, role)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * Changing your own role is disabled rather than hidden, because the reason is not obvious.
 * The server refuses it too — this is only so nobody wonders why nothing happened.
 */
function RolePicker({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: StaffRow["role"];
  disabled: boolean;
  onChange: (role: StaffRow["role"]) => void;
}) {
  return (
    <Select
      id={`role-${id}`}
      aria-label="Role"
      className="w-40"
      value={value}
      disabled={disabled}
      title={disabled ? "Another admin has to change your own role" : undefined}
      onChange={(event) => onChange(event.target.value as StaffRow["role"])}
    >
      <option value="customer">No access</option>
      <option value="staff">Staff</option>
      <option value="admin">Admin</option>
    </Select>
  );
}
