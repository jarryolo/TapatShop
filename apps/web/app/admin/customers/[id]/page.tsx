import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  type FulfillmentStatus,
  FulfillmentStatusPill,
  type OrderStatus,
  OrderStatusPill,
  type PaymentStatus,
  PaymentStatusPill,
} from "@/components/admin/status-pill";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/api/guard";
import { db } from "@/lib/db";
import { getCustomer } from "@/lib/services/customer.service";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

import { MemberPanel } from "./member-panel";

export const metadata: Metadata = { title: "Customer — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The layout already established staff; this is only to decide what the page may offer.
  const guard = await requireStaff();
  const isAdmin = guard.ok && guard.actor.role === "admin";

  const customer = await getCustomer(db, id);
  if (!customer) notFound();

  const signIn = customer.accounts.length > 0 ? "Google" : "Email and password";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[{ label: "Customers", href: "/admin/customers" }, { label: customer.name }]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">
            {customer.name}
          </h1>
          <p className="mt-1 truncate text-sm text-text-muted">{customer.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {customer.isMember ? <Badge tone="brand">Member</Badge> : null}
          {customer.disabledAt ? <Badge tone="danger">Disabled</Badge> : null}
          {!customer.emailVerifiedAt ? <Badge tone="warning">Email unverified</Badge> : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
              <span className="text-sm text-text-muted">
                {formatPeso(customer.lifetimeValueCents)} lifetime
              </span>
            </CardHeader>

            {customer.orders.length === 0 ? (
              <EmptyState title="No orders yet" body="This customer has not ordered anything." />
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {customer.orders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 hover:underline"
                    >
                      <span className="font-semibold">{order.orderNo}</span>
                      <span className="text-[13px] text-text-muted">
                        {formatDate(order.createdAt.toISOString())}
                      </span>
                      <OrderStatusPill status={order.status as OrderStatus} />
                      <PaymentStatusPill status={order.paymentStatus as PaymentStatus} />
                      <FulfillmentStatusPill
                        status={order.fulfillmentStatus as FulfillmentStatus}
                      />
                      <span className="ml-auto font-semibold tabular-nums">
                        {formatPeso(order.totalCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved addresses</CardTitle>
            </CardHeader>
            {customer.addresses.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">None saved.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3 text-sm">
                {customer.addresses.map((address) => (
                  <li key={address.id}>
                    <p className="font-semibold">
                      {address.label ?? address.recipient}
                      {address.isDefault ? (
                        <Badge className="ml-2" tone="neutral">
                          Default
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-text-muted">
                      {address.street}, {address.barangay}, {address.city}, {address.province}{" "}
                      {address.postalCode ?? ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <MemberPanel
            customerId={customer.id}
            isMember={customer.isMember}
            memberNo={customer.memberNo}
            chapter={customer.chapter}
            verifiedAt={customer.memberVerifiedAt?.toISOString() ?? null}
            canVerify={isAdmin}
          />

          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <dl className="mt-3 flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-text-muted">Signs in with</dt>
                <dd className="mt-0.5">{signIn}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Phone</dt>
                <dd className="mt-0.5">{customer.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Recovery email</dt>
                <dd className="mt-0.5 break-all">{customer.recoveryEmail ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Joined</dt>
                <dd className="mt-0.5">{formatDate(customer.createdAt.toISOString())}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Last signed in</dt>
                <dd className="mt-0.5">
                  {customer.lastLoginAt ? formatDateTime(customer.lastLoginAt.toISOString()) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Marketing email</dt>
                <dd className="mt-0.5">{customer.marketingOptIn ? "Opted in" : "No"}</dd>
              </div>
            </dl>

            {/*
              There is no password field here and there is no "reset password" button. An admin
              cannot read, set, or bypass a password — docs/07. If this customer is locked out,
              they file a recovery request and an admin approves it, which sends a link to them.
            */}
            <p className="mt-4 border-t border-border pt-3 text-[13px] text-text-muted">
              Passwords are never visible or settable from here. A locked-out customer uses{" "}
              <Link href="/recover-account" className="font-semibold text-brand-600 underline">
                account recovery
              </Link>
              .
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
