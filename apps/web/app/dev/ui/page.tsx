import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Gallery } from "./gallery";

export const metadata: Metadata = {
  title: "UI gallery — TapatShop",
  robots: { index: false, follow: false },
};

/**
 * Every primitive in every state, on one page, for review.
 *
 * Development and staging only. It is not behind auth, so in production it must not exist
 * at all rather than merely be unlinked.
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
