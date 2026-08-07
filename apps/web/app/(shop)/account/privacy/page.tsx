import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { ERASURE_TERMS, privacyService } from "@/lib/services/privacy.service";

import { DeletionForm } from "./deletion-form";

export const metadata: Metadata = {
  title: "Your data — TapatShop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountPrivacyPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?callbackUrl=/account/privacy");

  const pending = await privacyService.openRequestFor(session.user.id);

  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 md:px-6 md:py-12">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Your data</h1>
        <p className="mt-1 text-sm text-text-muted">
          Under the Data Privacy Act you can ask us to erase the personal data we hold about you.
        </p>
      </header>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>What erasure removes</CardTitle>
        </CardHeader>
        {/* Rendered from the same constant the service freezes onto the request, so the page
            and what actually happens cannot drift apart. */}
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {ERASURE_TERMS.removed.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <h3 className="mt-5 font-semibold">What has to stay</h3>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {ERASURE_TERMS.kept.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-text-muted">{ERASURE_TERMS.keptWhy}</p>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Request erasure</CardTitle>
        </CardHeader>
        <p className="mt-1 text-sm text-text-muted">
          This is a request rather than a button that fires immediately — if you have an order in
          transit it needs to reach you first.
        </p>
        <div className="mt-4">
          <DeletionForm alreadyPending={pending !== null} />
        </div>
      </Card>
    </div>
  );
}
