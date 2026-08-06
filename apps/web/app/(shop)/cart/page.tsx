import type { Metadata } from "next";

import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Your cart — TapatShop" };

// Never cached — docs/02.
export const dynamic = "force-dynamic";

export default function CartPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
      <h1 className="mb-6 text-2xl font-semibold md:text-[32px] md:leading-tight">Your cart</h1>
      <CartView />
    </div>
  );
}
