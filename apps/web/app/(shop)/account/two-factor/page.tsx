import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { status } from "@/lib/services/two-factor.service";

import { TwoFactorSetup } from "./two-factor-setup";

export const metadata: Metadata = {
  title: "Two-factor authentication — TapatShop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Enrolment lives under /account rather than /admin.
 *
 * The admin shell redirects un-enrolled staff here, so a page inside that shell would redirect
 * to itself. Being outside it also means a customer who wants a second factor can have one.
 */
export default async function TwoFactorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?callbackUrl=/account/two-factor");

  const current = await status(db, session.user.id);

  return (
    <div className="mx-auto max-w-[640px] px-4 py-8 md:px-6 md:py-12">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">
          Two-factor authentication
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          A code from your phone on top of your password, so a leaked password is not enough on its
          own.
        </p>
      </header>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Authenticator app</CardTitle>
        </CardHeader>
        <div className="mt-4">
          <TwoFactorSetup initial={current} />
        </div>
      </Card>
    </div>
  );
}
