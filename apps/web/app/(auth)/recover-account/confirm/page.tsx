import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";

import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = {
  title: "Confirm your new email — TapatShop",
  robots: { index: false, follow: false },
};

export default async function ConfirmRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">That link is incomplete</h1>
        <p className="mt-2 text-sm text-text-muted">
          Open the link exactly as it arrived in your email.
        </p>
        <Link
          href="/recover-account"
          className="mt-4 inline-block font-semibold text-brand-600 hover:underline"
        >
          Start again
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-2xl font-semibold">Confirm your new email</h1>
      <p className="mt-1 text-sm text-text-muted">
        An admin checked your request against your order history. Confirming moves your account to
        this address.
      </p>
      <ConfirmForm token={token} />
    </Card>
  );
}
