import type { Metadata } from "next";
import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db";
import { listRecoveryRequests } from "@/lib/services/customer.service";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Account recovery — TapatShop admin" };
export const dynamic = "force-dynamic";

const TONES: Record<string, BadgeTone> = {
  pending: "warning",
  approved: "brand",
  confirmed: "success",
  rejected: "neutral",
};

export default async function AdminRecoveryPage() {
  const requests = await listRecoveryRequests(db);
  const pending = requests.filter((request) => request.status === "pending");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Account recovery</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          People who have lost the email their account signs in with. Check each claim against the
          order history shown, then approve — which sends a confirmation link to the new address.
          Approving never sets a password.
        </p>
      </header>

      {requests.length === 0 ? (
        <Card>
          <EmptyState
            title="No recovery requests"
            body="Requests filed from the public recovery form appear here."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {requests.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/admin/recovery/${request.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-sunken md:px-5"
                >
                  <span className="font-semibold">{request.claimedName}</span>
                  <Badge tone={TONES[request.status] ?? "neutral"}>{request.status}</Badge>
                  {request.user ? (
                    <span className="text-[13px] text-text-muted">
                      matched to {request.user.email}
                    </span>
                  ) : (
                    <span className="text-[13px] text-warning-strong">no account matched</span>
                  )}
                  <span className="ml-auto text-[13px] text-text-muted">
                    {formatDateTime(request.createdAt.toISOString())}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pending.length > 0 ? (
        <p className="text-[13px] text-text-muted">{pending.length} waiting for a decision.</p>
      ) : null}
    </div>
  );
}
