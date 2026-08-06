import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";

import { SignInForm } from "./signin-form";

export const metadata: Metadata = { title: "Sign in — TapatShop" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <Card>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-text-muted">
        New here?{" "}
        <Link href="/register" className="font-semibold text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>

      <SignInForm callbackUrl={next ?? "/"} initialError={error} />
    </Card>
  );
}
