import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatPeso } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Payment (stub) — TapatShop", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Stands in for PayMongo's hosted checkout while P3-04 is unbuilt.
 *
 * Development only — it 404s anywhere else, and payment.service refuses to hand out a stub
 * session in production regardless. It deliberately does NOT mark the order paid: only a
 * verified webhook does that (docs/06), and pretending otherwise here would build the exact
 * habit the payments doc warns against.
 */
export default async function StubPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ orderNo?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { orderNo } = await searchParams;
  if (!orderNo) notFound();

  const order = await db.order.findUnique({
    where: { orderNo },
    select: { orderNo: true, totalCents: true, paymentStatus: true },
  });
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-[560px] px-4 py-12">
      <Card className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-warning-text">
            Development stub
          </p>
          <h1 className="mt-1 text-2xl font-semibold">PayMongo is not connected yet</h1>
        </div>

        <p className="text-[15px] text-text-muted">
          In production this is PayMongo&rsquo;s hosted checkout page. The real integration is
          ticket P3-04, which needs test keys and a webhook tunnel.
        </p>

        <dl className="flex flex-col gap-2 rounded-[var(--radius-ctrl)] bg-page p-3 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-text-muted">Order</dt>
            <dd className="font-semibold">{order.orderNo}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">Amount</dt>
            <dd className="font-semibold tabular-nums">{formatPeso(order.totalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">Payment status</dt>
            <dd className="font-semibold">{order.paymentStatus}</dd>
          </div>
        </dl>

        <p className="text-[13px] text-text-muted">
          The order is real and its stock is reserved for 15 minutes. It stays{" "}
          <strong>awaiting payment</strong> because only a verified webhook may mark an order paid —
          docs/06. If nobody pays, the reservation expires and the stock returns.
        </p>

        <Link href="/products" className="font-semibold text-brand-600 hover:underline">
          Back to the catalog
        </Link>
      </Card>
    </div>
  );
}
