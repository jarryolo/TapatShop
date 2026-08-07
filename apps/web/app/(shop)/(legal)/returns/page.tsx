import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/lib/db";
import { readSetting } from "@/lib/services/settings.service";

export const metadata: Metadata = { title: "Returns and refunds — TapatShop" };

export const revalidate = 3600;

const LAST_REVIEWED = "7 August 2026";

/**
 * The returns policy — docs/01 requires one before launch.
 *
 * Deliberately states the statutory floor rather than only the shop's own terms. Under the
 * Consumer Act a seller cannot contract out of the remedy for a defective product, so a policy
 * that only mentions a seven-day window would be misleading about a right the customer has
 * regardless.
 *
 * **This has not been reviewed by a lawyer.** docs/08 P5-01 records that as outstanding.
 */
export default async function ReturnsPage() {
  const contact = await readSetting(db, "store_email", "");

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">
        Returns and refunds
      </h1>
      <p className="text-sm text-text-muted">Last reviewed {LAST_REVIEWED}.</p>

      <h2 className="mt-4 text-xl font-semibold">If something arrives damaged or wrong</h2>
      <p>
        Tell us within seven days of delivery and we will replace it or refund it in full, including
        the delivery charge. Photographs help but are not a condition. This is your right under the
        Consumer Act of the Philippines (RA 7394) for a defective or misdescribed product, and
        nothing on this page limits it.
      </p>

      <h2 className="mt-4 text-xl font-semibold">If you simply changed your mind</h2>
      <p>
        Send it back within seven days of delivery, unused and in its original packaging, and we
        will refund the price of the goods. Return postage is yours to pay in that case, and the
        original delivery charge is not refunded.
      </p>
      <p>
        Some things cannot be returned for a change of mind: food and drink, and anything made or
        printed to order. We will say so on the product page before you buy.
      </p>

      <h2 className="mt-4 text-xl font-semibold">How to start a return</h2>
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        <li>
          Find your order number — it looks like TS-2026-000123, and it is on your confirmation
          email. You can also{" "}
          <Link href="/orders/track" className="font-semibold text-brand-600 hover:underline">
            look it up
          </Link>{" "}
          with the order number and the email you used.
        </li>
        <li>
          {contact ? (
            <>
              Write to <span className="font-semibold">{String(contact)}</span> with the order
              number and what is wrong.
            </>
          ) : (
            "Write to us with the order number and what is wrong."
          )}
        </li>
        <li>We reply with where to send it, or arrange a pickup if the fault is ours.</li>
      </ol>

      <h2 className="mt-4 text-xl font-semibold">How a refund reaches you</h2>
      <p>
        Refunds go back through PayMongo to the card or account you paid with. We cannot send a
        refund anywhere else, because we never hold your card details. Once we issue it, the time it
        takes to appear is your bank&rsquo;s, not ours — usually a few working days.
      </p>
      <p>
        A partial refund is possible when only part of an order is affected. You will see the exact
        amount before we issue it.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Cancelling before it ships</h2>
      <p>
        If your order has not been packed yet, ask and we will cancel and refund it in full. Once it
        is with the courier it has to come back as a return.
      </p>
    </>
  );
}
