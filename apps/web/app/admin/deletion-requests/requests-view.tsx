"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils/format";

export interface RequestRow {
  id: string;
  status: "pending" | "completed" | "refused";
  reason: string | null;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewerName: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  openOrders: number;
}

const TONES: Record<string, BadgeTone> = {
  pending: "warning",
  completed: "neutral",
  refused: "neutral",
};

export function RequestsView({ rows }: { rows: RequestRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function decide(row: RequestRow, decision: "complete" | "refuse") {
    let reason: string | undefined;

    if (decision === "refuse") {
      reason = window.prompt("Why is this request being refused?")?.trim() || undefined;
      if (!reason) return;
    } else {
      const warning =
        row.openOrders > 0
          ? `${row.userName} has ${row.openOrders} order(s) not yet delivered. Erasing now removes the delivery address from them. Continue?`
          : `Erase ${row.userName}? This cannot be undone. Their orders stay, with personal details removed.`;
      if (!window.confirm(warning)) return;
    }

    setPending(row.id);
    const response = await fetch(`/api/v1/admin/deletion-requests/${row.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision === "refuse" ? { decision, reason } : { decision }),
    });
    setPending(null);

    const body = await response.json();
    if (!response.ok) {
      toast(body.error?.message ?? "Could not record that decision.", "error");
      return;
    }

    toast(body.message ?? "Recorded.", "success");
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No requests"
          body="Erasure requests filed from the account privacy page appear here."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardHeader>
            <CardTitle>
              {row.status === "completed" ? (
                row.userName
              ) : (
                <Link
                  href={`/admin/customers/${row.userId}`}
                  className="hover:text-brand-600 hover:underline"
                >
                  {row.userName}
                </Link>
              )}
            </CardTitle>
            <Badge tone={TONES[row.status] ?? "neutral"}>{row.status}</Badge>
          </CardHeader>

          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-text-muted">Account</dt>
              <dd className="break-all">
                {row.userEmail} ({row.userRole})
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-text-muted">Filed</dt>
              <dd>{formatDateTime(row.createdAt)}</dd>
            </div>
            {row.reason ? (
              <div className="flex flex-wrap gap-x-3">
                <dt className="text-text-muted">They said</dt>
                <dd>{row.reason}</dd>
              </div>
            ) : null}
            {row.reviewerName ? (
              <div className="flex flex-wrap gap-x-3">
                <dt className="text-text-muted">Handled by</dt>
                <dd>
                  {row.reviewerName}
                  {row.reviewedAt ? ` on ${formatDateTime(row.reviewedAt)}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>

          {row.status === "pending" && row.openOrders > 0 ? (
            <p className="mt-3 rounded-[var(--radius-ctrl)] border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
              {row.openOrders} order{row.openOrders === 1 ? "" : "s"} not yet delivered. Erasing now
              removes the delivery address from them, so the courier cannot be re-briefed.
            </p>
          ) : null}

          {row.userRole !== "customer" ? (
            <p className="mt-3 text-[13px] text-text-muted">
              Staff and admin accounts cannot be erased here — their id is referenced by every audit
              entry they wrote, and anonymising an actor is how an audit log stops answering
              &ldquo;who did this&rdquo;.
            </p>
          ) : null}

          {row.status === "pending" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="danger"
                size="sm"
                loading={pending === row.id}
                disabled={row.userRole !== "customer"}
                onClick={() => decide(row, "complete")}
              >
                Erase this account
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={pending === row.id}
                onClick={() => decide(row, "refuse")}
              >
                Refuse
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
