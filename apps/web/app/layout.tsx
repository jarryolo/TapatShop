import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "TapatShop",
  description: "Honest goods from the brotherhood.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
