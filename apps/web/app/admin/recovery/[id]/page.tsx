import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { recoveryEvidence } from "@/lib/services/customer.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

import { ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "Recovery request — TapatShop admin" };
export const dynamic = "force-dynamic";

const TONES: Record<string, BadgeTone> = {
  pending: "warning",
  approved: "brand",
  confirmed: "success",
  rejected: "neutral",
};

function Check({ label, ok, claim }: { label: string; ok: boolean; claim: string | null }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span aria-hidden="true" className={ok ? "text-success-strong" : "text-text-soft"}>
        {ok ? "✓" : "✕"}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">
          {label}
          <span className="sr-only">: {ok ? "matches" : "does not match"}</span>
        </span>
        <span className="block break-words text-[13px] text-text-muted">
          {claim ? `They said: ${claim}` : "Not provided"}
        </span>
      </span>
    </li>
  );
}

export default async function AdminRecoveryRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const evidence = await recoveryEvidence(db, id);
  if (!evidence) notFound();

  const { request, checks, matchCount, orders, claimedOrder } = evidence;
  const decided = request.status !== "pending";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: "Account recovery", href: "/admin/recovery" },
          { label: request.claimedName },
        ]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">
            {request.claimedName}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Filed {formatDateTime(request.createdAt.toISOString())}
          </p>
        </div>
        <Badge tone={TONES[request.status] ?? "neutral"}>{request.status}</Badge>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What they can prove</CardTitle>
              <span className="text-sm text-text-muted">
                {matchCount} of 4 match
                {matchCount < 2 ? " — docs/07 asks for two" : ""}
              </span>
            </CardHeader>

            <ul className="mt-2 divide-y divide-border">
              <Check
                label="Name on the account"
                ok={checks.nameMatches}
                claim={request.claimedName}
              />
              <Check
                label="Member number"
                ok={checks.memberNoMatches}
                claim={request.claimedMemberNo}
              />
              <Check
                label="Order number belongs to this account"
                ok={checks.orderBelongsToUser}
                claim={request.claimedOrderNo}
              />
              <Check
                label="Delivery address on that order"
                ok={checks.addressMatches}
                claim={request.claimedAddress}
              />
            </ul>

            {claimedOrder && !checks.orderBelongsToUser ? (
              <p className="mt-3 rounded-[var(--radius-ctrl)] border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
                Order {claimedOrder.orderNo} exists, but it is not on this account. An order number
                that someone else can see is not proof of anything.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order history on the matched account</CardTitle>
            </CardHeader>
            {orders.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">
                No orders — so there is nothing here to check the claim against.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border text-sm">
                {orders.map((order) => {
                  const address = (order.shippingAddress ?? {}) as Record<string, string>;
                  return (
                    <li key={order.orderNo} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
                      <span className="font-semibold">{order.orderNo}</span>
                      <span className="text-text-muted">
                        {formatDate(order.createdAt.toISOString())}
                      </span>
                      <span className="w-full text-[13px] text-text-muted sm:w-auto">
                        {[address.street, address.barangay, address.city]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </span>
                      <span className="ml-auto tabular-nums">{formatPeso(order.totalCents)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Decision</CardTitle>
            </CardHeader>

            <dl className="mt-3 flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-text-muted">Matched account</dt>
                <dd className="mt-0.5 break-all">
                  {request.user ? (
                    <Link
                      href={`/admin/customers/${request.user.id}`}
                      className="font-semibold text-brand-600 underline"
                    >
                      {request.user.email}
                    </Link>
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Send the link to</dt>
                <dd className="mt-0.5 break-all font-semibold">{request.newEmail}</dd>
              </div>
              {request.reviewer ? (
                <div>
                  <dt className="text-text-muted">Reviewed by</dt>
                  <dd className="mt-0.5">
                    {request.reviewer.name}
                    {request.reviewedAt
                      ? ` on ${formatDateTime(request.reviewedAt.toISOString())}`
                      : ""}
                  </dd>
                </div>
              ) : null}
              {request.reviewNote ? (
                <div>
                  <dt className="text-text-muted">Note</dt>
                  <dd className="mt-0.5">{request.reviewNote}</dd>
                </div>
              ) : null}
            </dl>

            {decided ? (
              <p className="mt-4 border-t border-border pt-3 text-[13px] text-text-muted">
                Already handled. A request is decided once — file a new one if this needs
                revisiting.
              </p>
            ) : (
              <ReviewActions
                requestId={request.id}
                matchCount={matchCount}
                hasUser={request.userId !== null}
              />
            )}
          </Card>

          {/*
            Stated on the screen, not just in the docs. An admin reading this should never
            go looking for a password field, and should know what approving actually does.
          */}
          <Card>
            <CardHeader>
              <CardTitle>What approving does</CardTitle>
            </CardHeader>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-text-muted">
              <li>Emails a confirmation link, valid for two hours, to the new address.</li>
              <li>Changes nothing until the customer opens that link.</li>
              <li>
                Moves the sign-in email and signs out every device — the customer then uses
                forgot-password themselves.
              </li>
              <li className="font-semibold text-text">
                Never sets, reads, or reveals a password. There is no way to do that from here.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
