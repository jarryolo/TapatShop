import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";
import { readSetting } from "@/lib/services/settings.service";

export const metadata: Metadata = pageMetadata({
  title: "Terms of service",
  description: "How buying from TapatShop works, and the rules both sides are held to.",
  path: "/terms",
});

export const revalidate = 3600;

const LAST_REVIEWED = "7 August 2026";

/**
 * Terms of service — docs/01 requires them before launch.
 *
 * **This has not been reviewed by a lawyer.** docs/08 P5-01 records that as outstanding. What
 * is written here describes how the system behaves, which is the part worth getting right
 * first: a lawyer can tighten the language, but only the code knows when a contract is formed.
 */
export default async function TermsPage() {
  const [storeName, tin] = await Promise.all([
    readSetting(db, "store_name", "TapatShop"),
    readSetting(db, "store_tin", ""),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Terms of service</h1>
      <p className="text-sm text-text-muted">Last reviewed {LAST_REVIEWED}.</p>

      <p>
        These terms cover buying from {storeName}. Using the site means accepting them. They are
        governed by Philippine law.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Accounts</h2>
      <p>
        You can browse and check out as a guest. An account lets you save addresses, keep a list of
        saved items, and see your order history. Keep your password to yourself — anyone who has it
        can order as you. Tell us at once if you think someone else has it.
      </p>
      <p>
        Member pricing is for brothers whose membership an administrator has verified against the
        chapter roster. It is not self-declared, and it can be withdrawn if the membership lapses.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Prices and when an order is agreed</h2>
      <p>
        Prices are in Philippine pesos and include any tax due. The price you pay is the one this
        site calculates when you check out, from our own records — not the one your browser was
        showing. If a price has changed since you added something to your basket, you will see the
        new total before you pay.
      </p>
      <p>
        Placing an order is an offer to buy. The contract is formed when we confirm your payment,
        not when you click the button. If we cannot fulfil an order — the last one sold a moment
        earlier, or a price was plainly wrong — we will tell you and refund you in full.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Stock</h2>
      <p>
        Stock is held for you for fifteen minutes while you complete checkout. If you do not finish
        in that time it goes back on sale, and someone else may buy it.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Payment</h2>
      <p>
        Payment is taken by PayMongo on their own page. We never see or store your card details. An
        order counts as paid only once PayMongo confirms it to us directly — returning to this site
        from the payment page does not by itself mean the payment went through.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Delivery</h2>
      <p>
        We deliver within the Philippines. Delivery estimates are estimates, not promises: once a
        parcel is with the courier its timing is out of our hands. Risk passes to you on delivery.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Returns</h2>
      <p>
        Set out on the{" "}
        <Link href="/returns" className="font-semibold text-brand-600 hover:underline">
          returns and refunds
        </Link>{" "}
        page. Nothing there or here removes your rights under the Consumer Act of the Philippines
        (RA 7394).
      </p>

      <h2 className="mt-4 text-xl font-semibold">Reviews</h2>
      <p>
        Only customers who bought a product can review it, and every review is read by someone
        before it appears. We will not publish reviews that identify other people, advertise
        something else, or are abusive. We do not delete a review for being unfavourable.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Your data</h2>
      <p>
        Covered by the{" "}
        <Link href="/privacy" className="font-semibold text-brand-600 hover:underline">
          privacy policy
        </Link>
        .
      </p>

      <h2 className="mt-4 text-xl font-semibold">Changes</h2>
      <p>
        We may update these terms. The date at the top says when they were last reviewed. Orders
        already placed are governed by the terms in force when they were placed.
      </p>

      {tin ? (
        <p className="mt-6 text-sm text-text-muted">
          {storeName} · TIN {String(tin)}
        </p>
      ) : null}
    </>
  );
}
