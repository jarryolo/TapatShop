import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/lib/auth";

import { CheckoutFlow } from "./checkout-flow";

export const metadata: Metadata = { title: "Checkout — TapatShop", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Checkout: address → shipping → payment.
 *
 * docs/05: single column, max 560px, visible 3-step progress, no site nav. The header and
 * footer come from the shop layout; everything else here is deliberately narrow.
 */
export default async function CheckoutPage() {
  const session = await auth();

  return (
    <div className="mx-auto max-w-[560px] px-4 py-8 md:py-12">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Checkout</h1>
        <Link href="/cart" className="text-sm font-semibold text-brand-600 hover:underline">
          Back to cart
        </Link>
      </div>

      <CheckoutFlow
        signedIn={Boolean(session?.user)}
        accountEmail={session?.user?.email ?? ""}
        accountName={session?.user?.name ?? ""}
      />
    </div>
  );
}
