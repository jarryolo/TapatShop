import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

import { ToastProvider } from "@/components/ui/toast";
import { IS_INDEXABLE, SITE_NAME, SITE_URL } from "@/lib/seo";

import "./globals.css";

// Two weights only, per docs/05. Every extra weight is another font file on a 4G connection.
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-plus-jakarta",
});

export const metadata: Metadata = {
  /**
   * Every relative URL in metadata resolves against this — Open Graph images especially, which
   * crawlers fetch from their own servers and cannot resolve a relative path from.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — honest goods from the brotherhood`,
    // Pages set a bare title; the suffix is added once, here.
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "Member-made goods, branded merchandise, books and food products. Clear prices, no fake urgency.",
  applicationName: SITE_NAME,
  // Blanket no-index on anything that is not the production site, so a staging copy cannot
  // compete with the real shop for its own listings.
  robots: IS_INDEXABLE ? undefined : { index: false, follow: false },
  openGraph: {
    siteName: SITE_NAME,
    locale: "en_PH",
    type: "website",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
