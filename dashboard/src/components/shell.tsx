"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, CreditCard, FileText, Globe, LayoutDashboard, Lock, LogOut, Menu, MessageCircle, Settings, ShoppingBag, Users, Wallet } from "lucide-react";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { useAuth } from "@/lib/auth";
import { authed } from "@/lib/api";
import { canWrite, roleLabel } from "@/lib/access";
import { getSupabase } from "@/lib/supabase";
import type { Me } from "@/lib/types";
import { ErrorNote, Loading } from "./ui";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard, feature: "" },
  { href: "/invoices", label: "Invoices", icon: FileText, feature: "" },
  { href: "/payments", label: "Payments", icon: Wallet, feature: "" },
  { href: "/customers", label: "Customers", icon: Users, feature: "" },
  { href: "/billing", label: "Plans", icon: CreditCard, feature: "" },
  { href: "/website", label: "Website", icon: Globe, feature: "" },
  { href: "/pos", label: "Counter", icon: ShoppingBag, feature: "pos" },
  { href: "/reminders", label: "Reminders", icon: Bell, feature: "auto_reminders" },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, feature: "whatsapp_click_to_chat" },
  { href: "/settings", label: "Settings", icon: Settings, feature: "" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, configured, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { entitlements } = useEntitlements();

  useEffect(() => {
    if (!ready) return;
    if (!configured || !session) {
      router.replace("/login");
    }
  }, [ready, configured, session, router]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    authed<Me>("/auth/me")
      .then((profile) => {
        if (cancelled) return;
        setMe(profile);
        const hasTenant = Boolean(profile.user?.tenant_id) || profile.memberships.some((row) => row.status === "active");
        if (!hasTenant) router.replace("/onboarding");
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session, router]);

  if (!ready || !session) return <div className="p-8"><Loading label="Checking your session" /></div>;
  if (error) return <div className="p-8"><ErrorNote message={error} /></div>;
  if (!me) return <div className="p-8"><Loading label="Loading your business" /></div>;

  const role = me.user?.role ?? null;
  const tenantName = me.memberships.find((row) => row.tenant?.id === me.user?.tenant_id)?.tenant?.name ?? "Your business";

  const links = (
    <nav className="flex flex-col gap-1" aria-label="Dashboard">
      {nav.map((item) => {
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={16} aria-hidden />
            {item.label}
            {item.feature && entitlements && !featureOn(entitlements, item.feature) ? <Lock size={12} aria-label="Locked" /> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#f4f6f5] md:grid md:grid-cols-[240px_1fr]">
      <aside className="no-print hidden bg-navy text-white md:flex md:flex-col md:px-4 md:py-6">
        <Link href="/" className="px-2">
          <img src="/brand/billflow-logo-horizontal-white.svg" alt="billflow" width={150} height={30} />
        </Link>
        <div className="mt-8 flex-1">{links}</div>
        <button
          type="button"
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-300 hover:text-white"
          onClick={() => void getSupabase().auth.signOut().then(() => router.replace("/login"))}
        >
          <LogOut size={16} aria-hidden /> Sign out
        </button>
      </aside>
      <div className="min-w-0">
        <header className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-md p-2 md:hidden" aria-expanded={open} aria-label="Open menu" onClick={() => setOpen((value) => !value)}>
              <Menu size={18} />
            </button>
            <div>
              <p className="text-sm font-semibold text-navy">{tenantName}</p>
              <p className="text-xs text-slate-500">{roleLabel(role)}{canWrite(role) ? "" : " · read only"}</p>
            </div>
          </div>
          <p className="hidden text-sm text-slate-500 sm:block">{me.user?.email}</p>
        </header>
        {open ? <div className="no-print bg-navy px-4 py-4 md:hidden">{links}</div> : null}
        {!canWrite(role) ? (
          <p className="no-print bg-amber-50 px-4 py-2 text-sm text-amber-950 md:px-8">
            You can look through this business. Creating and editing is limited to owners, admins, and billing.
          </p>
        ) : null}
        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
