import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared shell for the policy pages.
 *
 * Narrow measure and generous line height because these are read, not scanned. The
 * last-reviewed date is at the top of each page rather than buried at the bottom: a policy
 * with no date is a policy nobody can tell is stale.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 md:px-6 md:py-12">
      <nav aria-label="Policies" className="mb-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/terms" className="text-text-muted hover:text-brand-600">
          Terms
        </Link>
        <Link href="/privacy" className="text-text-muted hover:text-brand-600">
          Privacy
        </Link>
        <Link href="/returns" className="text-text-muted hover:text-brand-600">
          Returns and refunds
        </Link>
      </nav>

      <div className="prose-tapat flex flex-col gap-5 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}
