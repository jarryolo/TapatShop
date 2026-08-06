import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { getOrderForAdmin } from "@/lib/services/admin-orders.service";
import { formatDate } from "@/lib/utils/format";
import { formatPeso } from "@/lib/utils/money";

import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Packing slip", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * A4 packing slip.
 *
 * Deliberately plain: black on white, no shadows, no brand fills. A slip is printed on an
 * office laser printer and read by someone picking stock, so ink coverage and legibility beat
 * anything decorative. It carries no prices by default — the person packing does not need
 * them, and a slip left in a box should not double as an invoice.
 */
export default async function PackingSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prices?: string }>;
}) {
  const [{ id }, { prices }] = await Promise.all([params, searchParams]);
  const order = await getOrderForAdmin(db, id);
  if (!order) notFound();

  const showPrices = prices === "true";
  const address = (order.shippingAddress ?? {}) as Record<string, string>;

  return (
    <>
      {/*
        Print rules. @page sets the physical paper and margins — without it browsers default
        to Letter in some locales, and the slip comes out cropped on A4.
      */}
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .slip { box-shadow: none !important; border: 0 !important; padding: 0 !important; }
          /* Keep a line item from splitting across the page break. */
          tr, li { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      <div className="mx-auto max-w-[210mm] bg-white p-6 text-black">
        <div className="no-print mb-6 flex flex-wrap items-center gap-3">
          <PrintButton />
          <a
            href={`?prices=${showPrices ? "false" : "true"}`}
            className="text-sm font-semibold text-brand-600 hover:underline"
          >
            {showPrices ? "Hide prices" : "Show prices"}
          </a>
          <a
            href={`/admin/orders/${order.id}`}
            className="text-sm font-semibold text-brand-600 hover:underline"
          >
            Back to order
          </a>
        </div>

        <div className="slip">
          <header className="flex items-start justify-between gap-8 border-b-2 border-black pb-4">
            <div>
              <p className="text-xl font-bold">TapatShop</p>
              <p className="text-sm">Honest goods from the brotherhood</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">Packing slip</p>
              <p className="text-sm">{order.orderNo}</p>
              <p className="text-sm">{formatDate(order.createdAt)}</p>
            </div>
          </header>

          <section className="mt-6 grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide">Deliver to</p>
              <address className="mt-1 not-italic text-sm leading-relaxed">
                <span className="block font-semibold">
                  {address.recipient ?? order.customerName}
                </span>
                <span className="block">{address.street}</span>
                <span className="block">
                  {[address.barangay, address.city, address.province].filter(Boolean).join(", ")}
                </span>
                {address.postalCode ? <span className="block">{address.postalCode}</span> : null}
                <span className="block">{address.phone ?? order.customerPhone}</span>
              </address>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide">Order</p>
              <dl className="mt-1 text-sm leading-relaxed">
                <div className="flex justify-between gap-4">
                  <dt>Items</dt>
                  <dd>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Payment</dt>
                  <dd>{order.paymentStatus.replace(/_/g, " ")}</dd>
                </div>
                {order.carrier ? (
                  <div className="flex justify-between gap-4">
                    <dt>Carrier</dt>
                    <dd>{order.carrier}</dd>
                  </div>
                ) : null}
                {order.trackingNumber ? (
                  <div className="flex justify-between gap-4">
                    <dt>Tracking</dt>
                    <dd>{order.trackingNumber}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </section>

          <table className="mt-8 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                {/* A tick box: the picker marks each line as it goes into the box. */}
                <th scope="col" className="w-8 py-2">
                  ✓
                </th>
                <th scope="col" className="py-2">
                  Item
                </th>
                <th scope="col" className="py-2">
                  SKU
                </th>
                <th scope="col" className="py-2 text-right">
                  Qty
                </th>
                {showPrices ? (
                  <th scope="col" className="py-2 text-right">
                    Total
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-black/30">
                  <td className="py-2">
                    <span className="inline-block size-4 border border-black" />
                  </td>
                  <td className="py-2">
                    <span className="block font-semibold">{item.productName}</span>
                    <span className="block text-xs">{item.variantName}</span>
                  </td>
                  <td className="py-2 font-mono text-xs">{item.sku}</td>
                  <td className="py-2 text-right font-semibold">{item.quantity}</td>
                  {showPrices ? (
                    <td className="py-2 text-right">{formatPeso(item.lineTotalCents)}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>

          {showPrices ? (
            <div className="mt-4 flex justify-end">
              <dl className="w-56 text-sm">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd>{formatPeso(order.subtotalCents)}</dd>
                </div>
                {order.discountCents > 0 ? (
                  <div className="flex justify-between">
                    <dt>Discount</dt>
                    <dd>−{formatPeso(order.discountCents)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt>Shipping</dt>
                  <dd>{formatPeso(order.shippingCents)}</dd>
                </div>
                <div className="mt-1 flex justify-between border-t border-black pt-1 font-bold">
                  <dt>Total</dt>
                  <dd>{formatPeso(order.totalCents)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {order.customerNote ? (
            <section className="mt-6 border border-black p-3">
              <p className="text-xs font-bold uppercase tracking-wide">Customer note</p>
              <p className="mt-1 text-sm">{order.customerNote}</p>
            </section>
          ) : null}

          <footer className="mt-10 border-t border-black/30 pt-3 text-xs">
            <p>
              Something wrong with this order? Reply to the confirmation email or visit
              tapatshop.com/orders/track with {order.orderNo}.
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
