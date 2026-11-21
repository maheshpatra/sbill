"use client";

import Link from "next/link";
import { notFound, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isSuperAdmin } from "@/lib/admin-access";
import { authed } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me } from "@/lib/types";

const links = [
  ["Plans", "/admin/plans"],
  ["Flags", "/admin/flags"],
  ["Templates", "/admin/templates"],
  ["Tenants", "/admin/tenants"],
  ["Site", "/admin/site"],
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { ready, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const localPreview = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("preview") === "local";
    if (localPreview) {
      setPreview(true);
      setAllowed(true);
      return;
    }
    if (!session) {
      router.replace("/login");
      return;
    }
    void authed<Me>("/auth/me")
      .then((me) => setAllowed(isSuperAdmin(me)))
      .catch((reason: Error) => setError(reason.message));
  }, [ready, session, router]);

  if (error) return <p className="p-8 text-sm">{error}</p>;
  if (!ready || allowed === null) return <p className="p-8 text-sm">Checking access…</p>;
  if (!allowed) notFound();

  return (
    <div className="min-h-screen bg-[#f4f6f5]">
      {preview ? (
        <p className="bg-amber-100 px-4 py-2 text-sm text-amber-950">Local preview. This is not a hosted super-admin session.</p>
      ) : null}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-navy px-4 py-4 text-white">
        <p className="font-semibold">billflow admin</p>
        <nav className="flex flex-wrap gap-2 text-sm">
          {links.map(([label, href]) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`rounded-full px-3 py-2 ${pathname === href ? "bg-white text-navy" : "text-slate-200"}`}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
