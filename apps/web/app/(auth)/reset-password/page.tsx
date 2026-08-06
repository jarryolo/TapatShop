import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password — TapatShop" };

export default async function ResetPasswordPage({
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
          Open the link from your email, or request a new one.
        </p>
        <Link
          href="/forgot-password"
          className="mt-4 inline-block font-semibold text-brand-600 hover:underline"
        >
          Request a new link
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="mt-1 text-sm text-text-muted">
        You will be signed out on every device once this is done.
      </p>
      <ResetPasswordForm token={token} />
    </Card>
  );
}
