"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, CreditCard, FileText, Globe, LayoutDashboard, Lock, LogOut, MessageCircle, Package, Receipt, Settings, ShoppingBag, Users, Wallet } from "lucide-react";
import { FirstRun } from "./intro-slides";
import { MobileNav } from "./mobile-nav";
import { LanguageSwitch } from "@/i18n/provider";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { useAuth } from "@/lib/auth";
import { authed } from "@/lib/api";
import { canWrite, roleLabel } from "@/lib/access";
import { readAvatar } from "@/lib/brand-assets";
import { getSupabase } from "@/lib/supabase";
import type { Me } from "@/lib/types";
import { ErrorNote, Loading } from "./ui";

const nav = [
  { href: "/", label: "today", icon: LayoutDashboard, feature: "" },
  { href: "/pos", label: "newBill", icon: ShoppingBag, feature: "pos" },
  { href: "/invoices", label: "bills", icon: FileText, feature: "" },
  { href: "/payments", label: "received", icon: Wallet, feature: "" },
  { href: "/customers", label: "customers", icon: Users, feature: "" },
  { href: "/products", label: "goods", icon: Package, feature: "product_catalog" },
  { href: "/purchases", label: "purchases", icon: Receipt, feature: "" },
  { href: "/billing", label: "plans", icon: CreditCard, feature: "" },
  { href: "/website", label: "site", icon: Globe, feature: "" },
  { href: "/reminders", label: "reminders", icon: Bell, feature: "auto_reminders" },
  { href: "/whatsapp", label: "whatsapp", icon: MessageCircle, feature: "whatsapp_click_to_chat" },
  { href: "/settings", label: "settings", icon: Settings, feature: "" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, configured, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { entitlements } = useEntitlements();
  const t = useTranslations("shell");

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
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={16} aria-hidden />
            {t(item.label)}
            {item.feature && entitlements && !featureOn(entitlements, item.feature) ? <Lock size={12} aria-label="Locked" /> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <FirstRun>
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
          <LogOut size={16} aria-hidden /> {t("signOut")}
        </button>
      </aside>
      <div className="min-w-0">
        <header className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold text-navy">{tenantName}</p>
              <p className="text-xs text-slate-500">{roleLabel(role)}{canWrite(role) ? "" : " · read only"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <AvatarMark src={me.user?.avatar_url} />
            <LanguageSwitch />
            <p className="hidden text-sm text-slate-500 sm:block">{me.user?.email}</p>
          </div>
        </header>
        {!canWrite(role) ? (
          <p className="no-print bg-amber-50 px-4 py-2 text-sm text-amber-950 md:px-8">
            {t("readOnly")}
          </p>
        ) : null}
        <main className="px-4 py-6 pb-[calc(8rem+env(safe-area-inset-bottom))] md:px-8 md:pb-6 print:pb-6">{children}</main>
        <MobileNav />
      </div>
    </div>
    </FirstRun>
  );
}

function AvatarMark({ src }: { src?: string | null }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    setLocal(readAvatar());
  }, []);
  const image = src || local;
  if (!image) return null;
  return <img src={image} alt="" className="h-8 w-8 rounded-full object-cover" />;
}
