import type { Metadata } from "next";

import { Card } from "@/components/ui/card";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password — TapatShop" };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-text-muted">
        We will send a link to your email. It expires in 30 minutes.
      </p>
      <ForgotPasswordForm />
    </Card>
  );
}
