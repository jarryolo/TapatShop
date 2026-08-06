import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";

import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = {
  title: "Recover your account — TapatShop",
  robots: { index: false, follow: false },
};

/**
 * docs/07 route 3, step 1 — the last resort, for someone who cannot open the email their
 * account signs in with. So nothing on this page may require receiving anything there.
 */
export default function RecoverAccountPage() {
  return (
    <Card>
      <h1 className="text-2xl font-semibold">Recover your account</h1>
      <p className="mt-1 text-sm text-text-muted">
        For when you can no longer open the email you sign in with. If you can still open it,{" "}
        <Link href="/forgot-password" className="font-semibold text-brand-600 hover:underline">
          reset your password
        </Link>{" "}
        instead — that is instant.
      </p>
      <RecoveryForm />
    </Card>
  );
}
