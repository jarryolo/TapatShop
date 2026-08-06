"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils/format";

/**
 * Member verification, for admins only.
 *
 * Staff never see this panel — but hiding it is cosmetic, and the route behind it calls
 * requireAdmin. If this component were rendered to a staff member by mistake, the button
 * would fail with a 403, not quietly work.
 */
export function MemberPanel({
  customerId,
  isMember,
  memberNo,
  chapter,
  verifiedAt,
  canVerify,
}: {
  customerId: string;
  isMember: boolean;
  memberNo: string | null;
  chapter: string | null;
  verifiedAt: string | null;
  canVerify: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ memberNo: memberNo ?? "", chapter: chapter ?? "" });

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const response = await fetch(`/api/v1/admin/customers/${customerId}/verify-member`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setPending(false);

    const body = await response.json();
    if (!response.ok) {
      toast(body.error?.message ?? "Could not verify this member.", "error");
      return;
    }

    setEditing(false);
    toast("Member verified. Member pricing applies from now on.", "success");
    router.refresh();
  }

  async function revoke() {
    if (
      !window.confirm(
        "Withdraw member verification? They will pay the regular price from their next order."
      )
    ) {
      return;
    }

    setPending(true);
    const response = await fetch(`/api/v1/admin/customers/${customerId}/verify-member`, {
      method: "DELETE",
    });
    setPending(false);

    if (!response.ok) {
      toast("Could not withdraw verification.", "error");
      return;
    }

    toast("Verification withdrawn.", "success");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brotherhood membership</CardTitle>
        {isMember ? <Badge tone="brand">Verified</Badge> : <Badge>Not verified</Badge>}
      </CardHeader>

      {isMember ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted">Member number</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{memberNo}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Chapter</dt>
            <dd className="mt-0.5 font-semibold">{chapter ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Verified</dt>
            <dd className="mt-0.5">{verifiedAt ? formatDate(verifiedAt) : "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          Member pricing is a discount on every order, so verify against the chapter roster first —
          not against what the customer typed at sign-up.
        </p>
      )}

      {!canVerify ? (
        <p className="mt-4 text-[13px] text-text-muted">Only an admin can change member status.</p>
      ) : editing || !isMember ? (
        <form onSubmit={verify} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="memberNo" label="Member number" required>
              <Input
                id="memberNo"
                required
                maxLength={40}
                value={form.memberNo}
                onChange={(event) => setForm({ ...form, memberNo: event.target.value })}
              />
            </Field>
            <Field id="chapter" label="Chapter" required>
              <Input
                id="chapter"
                required
                maxLength={80}
                value={form.chapter}
                onChange={(event) => setForm({ ...form, chapter: event.target.value })}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={pending}>
              {isMember ? "Save" : "Verify member"}
            </Button>
            {isMember ? (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit details
          </Button>
          <Button variant="danger" size="sm" loading={pending} onClick={revoke}>
            Withdraw verification
          </Button>
        </div>
      )}
    </Card>
  );
}
