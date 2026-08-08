import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { accountService } from "@/lib/services/account.service";
import { formatDateTime } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "Your account — TapatShop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The account home.
 *
 * The header has linked here for every signed-in customer since the shop layout was written,
 * and there was no page behind it — clicking your own name gave a 404.
 */
export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?callbackUrl=/account");

  const orders = await accountService.listOrders(session.user.id, 3);

  return (
    <div className="mx-auto max-w-[880px] px-4 py-8 md:px-6 md:py-12">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Your account</h1>
        <p className="mt-1 text-text-muted">Signed in as {session.user.email}.</p>
      </header>

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Recent orders</h2>
          {orders.length > 0 && (
            <Link href="/account/orders" className="text-[15px] font-semibold text-brand-600">
              See all orders
            </Link>
          )}
        </div>

        {orders.length === 0 ? (
          <Card className="mt-3">
            <p className="text-text-muted">
              You have not ordered anything yet.{" "}
              <Link href="/products" className="font-semibold text-brand-600">
                Browse the shop
              </Link>
              .
            </p>
            {/*
              Guest orders only join this list once the account's email is verified, so an
              unverified customer would otherwise see an empty page and assume the order is
              lost. Tracking works regardless.
            */}
            <p className="mt-2 text-sm text-text-muted">
              Ordered without an account?{" "}
              <Link href="/orders/track" className="font-semibold text-brand-600">
                Track it with your order number
              </Link>
              .
            </p>
          </Card>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {orders.map((order) => (
              <li key={order.orderNo}>
                <Link
                  href={`/account/orders/${order.orderNo}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-card)] border border-border-subtle bg-surface px-4 py-3 hover:border-brand-600"
                >
                  <span className="font-semibold">{order.orderNo}</span>
                  <span className="text-sm text-text-muted">
                    {formatDateTime(order.placedAt ?? order.createdAt)}
                  </span>
                  <span className="ml-auto tabular-nums">{formatPeso(order.totalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Settings</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <AccountLink
            href="/account/orders"
            title="Orders"
            body="Everything you have bought, with delivery status."
          />
          <AccountLink
            href="/wishlist"
            title="Wishlist"
            body="Saved items and back-in-stock alerts."
          />
          <AccountLink
            href="/account/two-factor"
            title="Two-step sign-in"
            body="Add a code from your phone to your sign-in."
          />
          <AccountLink
            href="/account/privacy"
            title="Your data"
            body="What we hold, and how to have it erased."
          />
        </ul>
      </section>
    </div>
  );
}

function AccountLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-[var(--radius-card)] border border-border-subtle bg-surface px-4 py-3 hover:border-brand-600"
      >
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-text-muted">{body}</span>
      </Link>
    </li>
  );
}
