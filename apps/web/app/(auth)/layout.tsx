import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Auth pages: one column, no site nav.
 *
 * Same reasoning docs/05 gives for checkout — strip everything that is not the task. A
 * customer trying to sign in does not need a category menu.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 self-center text-xl font-semibold">
        TapatShop
      </Link>
      {children}
    </main>
  );
}
