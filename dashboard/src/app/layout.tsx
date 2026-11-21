import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { EntitlementsProvider } from "@/lib/entitlements";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "billflow",
  description: "Send GST invoices, record payments, and see what you are owed.",
  icons: { icon: "/brand/favicon.ico" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={outfit.variable}>
      <body className="antialiased">
        <AuthProvider>
          <EntitlementsProvider>{children}</EntitlementsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
