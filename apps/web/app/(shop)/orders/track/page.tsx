import type { Metadata } from "next";

import { TrackForm } from "./track-form";

export const metadata: Metadata = {
  title: "Track an order — TapatShop",
  description: "Find your order with its number and the email you used.",
};

export default function TrackOrderPage() {
  return (
    <div className="mx-auto max-w-[640px] px-4 py-10 md:py-16">
      <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Track an order</h1>
      <p className="mt-2 text-text-muted">
        No account needed. Enter the order number and the email you used when ordering.
      </p>
      <TrackForm />
    </div>
  );
}
