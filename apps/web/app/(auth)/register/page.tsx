import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create an account — TapatShop" };

export default function RegisterPage() {
  return (
    <Card>
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-1 text-sm text-text-muted">
        Already have one?{" "}
        <Link href="/signin" className="font-semibold text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>

      <RegisterForm />
    </Card>
  );
}
