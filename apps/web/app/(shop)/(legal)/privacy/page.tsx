import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/lib/db";
import { readSetting } from "@/lib/services/settings.service";

export const metadata: Metadata = { title: "Privacy policy — TapatShop" };

/**
 * The privacy policy, required by the Data Privacy Act (RA 10173) — docs/01.
 *
 * Written from what the code actually does rather than from a template. Every claim here is
 * checkable against a service: the erasure section matches `privacy.service`, the retention
 * section matches what `completeDeletion` keeps, and the "we never see your card" claim is
 * true because docs/06 uses PayMongo hosted checkout and there is no card table.
 *
 * **This has not been reviewed by a lawyer.** docs/08 P5-01 records that as outstanding.
 */
export const revalidate = 3600;

const LAST_REVIEWED = "7 August 2026";

export default async function PrivacyPage() {
  const [storeName, contact] = await Promise.all([
    readSetting(db, "store_name", "TapatShop"),
    readSetting(db, "store_email", ""),
  ]);

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Privacy policy</h1>
      <p className="text-sm text-text-muted">Last reviewed {LAST_REVIEWED}.</p>

      <p>
        {storeName} collects and uses personal data under the Data Privacy Act of 2012 (RA 10173).
        This page says what we collect, why, how long we keep it, and how to have it removed. It
        describes what the system actually does, not what we intend it to do.
      </p>

      <h2 className="mt-4 text-xl font-semibold">What we collect</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>
          <strong>To create an account:</strong> your name, email address, mobile number, and a
          password. The password is stored only as an Argon2id hash — nobody here can read it,
          including administrators.
        </li>
        <li>
          <strong>To deliver an order:</strong> the recipient name, mobile number and address you
          enter at checkout. A copy is frozen onto the order so the record still shows where it
          actually went if you later edit your address book.
        </li>
        <li>
          <strong>If you are a member:</strong> your member number and chapter, verified by an
          administrator against the chapter roster.
        </li>
        <li>
          <strong>Automatically:</strong> the IP address and browser of administrative actions, for
          the audit log, and a cart identifier stored in a cookie so a guest basket survives a page
          reload.
        </li>
      </ul>

      <h2 className="mt-4 text-xl font-semibold">What we never collect</h2>
      <p>
        <strong>We never see your card details.</strong> Payment is handled by PayMongo on their own
        hosted page. Your card number does not pass through this site and there is no card data in
        our database. We record only whether a payment succeeded, the amount, and PayMongo&rsquo;s
        reference for it.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Why we use it</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>To take payment, deliver your order, and answer questions about it.</li>
        <li>To apply member pricing, where an administrator has verified your membership.</li>
        <li>To keep the sales and invoice records Philippine tax rules require.</li>
        <li>
          To send marketing email <em>only</em> if you ticked that box, which is separate from the
          consent needed to open an account and can be turned off at any time.
        </li>
      </ul>

      <h2 className="mt-4 text-xl font-semibold">How long we keep it</h2>
      <p>
        Order and invoice records are kept as long as tax rules require. Account details are kept
        while your account is open. Stock alerts are deleted once sent. Password reset links expire
        in 30 minutes and account recovery links in two hours.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Who else sees it</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>PayMongo, to take payment.</li>
        <li>The courier, to deliver your order — recipient, address and mobile number.</li>
        <li>Our email provider, to send order and account messages.</li>
      </ul>
      <p>We do not sell personal data, and we do not share it for anyone else&rsquo;s marketing.</p>

      <h2 className="mt-4 text-xl font-semibold">Your rights</h2>
      <p>
        Under the Data Privacy Act you may ask to see, correct, or erase the personal data we hold
        about you, object to how it is used, and complain to the National Privacy Commission.
      </p>
      <p>
        To have your data erased, use{" "}
        <Link href="/account/privacy" className="font-semibold text-brand-600 hover:underline">
          the erasure request form
        </Link>
        . That page states exactly what is removed and what has to stay.
      </p>

      <h2 className="mt-4 text-xl font-semibold">Contact</h2>
      <p>
        {contact ? (
          <>
            Write to <span className="font-semibold">{String(contact)}</span> with any question
            about this policy or the data we hold.
          </>
        ) : (
          "Contact details are published on the storefront."
        )}
      </p>
    </>
  );
}
