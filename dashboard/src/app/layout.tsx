import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { OfflineBootstrap } from "@/components/offline-bootstrap";
import { I18nProvider } from "@/i18n/provider";
import { AuthProvider } from "@/lib/auth";
import { EntitlementsProvider } from "@/lib/entitlements";
import { baloo, hind, tiro } from "./fonts";
import "./globals.css";
import "./invoice-templates.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:4319";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "billflow",
  description: "Send GST invoices, record payments, and see what you are owed.",
  applicationName: "billflow",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/brand/favicon.ico" },
      { url: "/brand/billflow-icon.svg", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    title: "billflow",
    description: "Send GST invoices, record payments, and see what you are owed.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: "billflow" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${outfit.variable} ${hind.variable} ${baloo.variable} ${tiro.variable}`}>
      <body className="antialiased">
        <I18nProvider>
          <AuthProvider>
            <EntitlementsProvider>
              <OfflineBootstrap />
              {children}
            </EntitlementsProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
