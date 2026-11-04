import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { TooltipProvider } from "@/components/overlays";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  applicationName: BRAND.name,
  title: { default: BRAND.title, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
  authors: [{ name: BRAND.company }],
  creator: BRAND.company,
  publisher: BRAND.company,
  openGraph: { title: BRAND.title, description: BRAND.description, siteName: BRAND.name, type: "website" },
  twitter: { card: "summary", title: BRAND.title, description: BRAND.description },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router root layout: this link applies to every route. Runtime
            Google Fonts with full system fallbacks keep builds offline-safe
            (next/font would hard-fail without network at build time). */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- Pages-Router rule; this is the App Router root layout */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="scene" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <TooltipProvider delayDuration={250}>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
