import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { landing } from "@/content/landing";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:4318";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "billflow — Get paid faster",
    template: "%s · billflow",
  },
  description: landing.shortDescription,
  applicationName: "billflow",
  keywords: ["GST invoice", "UPI payments", "billing software India", "small business invoicing"],
  openGraph: {
    title: landing.headline,
    description: landing.subheadline,
    url: siteUrl,
    siteName: "billflow",
    locale: "en_IN",
    type: "website",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: landing.headline }],
  },
  twitter: {
    card: "summary_large_image",
    title: landing.headline,
    description: landing.subheadline,
    images: ["/brand/og-image.png"],
  },
  icons: { icon: "/brand/favicon.ico" },
  alternates: { canonical: siteUrl },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={outfit.variable}>
      <body className="antialiased">
        <a href="#features" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">
          Skip to features
        </a>
        {children}
      </body>
    </html>
  );
}
