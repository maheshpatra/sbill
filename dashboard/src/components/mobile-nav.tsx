"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  Bell,
  BookOpen,
  CircleHelp,
  CreditCard,
  FileText,
  Globe,
  Home,
  Lock,
  LogOut,
  MessageCircle,
  Package,
  Plus,
  Receipt,
  Settings,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { getSupabase } from "@/lib/supabase";

const pressable = "transition active:scale-95 active:opacity-70 motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:active:opacity-100";

type SheetLabel = "products" | "purchases" | "reports" | "reminders" | "settings" | "plan" | "received" | "site" | "whatsapp";

const sheetItems: Array<{ href: string; label: SheetLabel; icon: LucideIcon; feature: string }> = [
  { href: "/products", label: "products", icon: Package, feature: "product_catalog" },
  { href: "/purchases", label: "purchases", icon: Receipt, feature: "" },
  { href: "/#reports", label: "reports", icon: BarChart3, feature: "reporting_dashboard" },
  { href: "/reminders", label: "reminders", icon: Bell, feature: "auto_reminders" },
  { href: "/settings", label: "settings", icon: Settings, feature: "" },
  { href: "/billing", label: "plan", icon: CreditCard, feature: "" },
  { href: "/payments", label: "received", icon: Wallet, feature: "" },
  { href: "/website", label: "site", icon: Globe, feature: "" },
  { href: "/whatsapp", label: "whatsapp", icon: MessageCircle, feature: "whatsapp_click_to_chat" },
];

const morePaths = sheetItems.map((item) => item.href.split("#")[0]).filter((href) => href !== "/");

function tap() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate?.(10);
}

function fieldFocused(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function MobileNav() {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const router = useRouter();
  const { entitlements } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [away, setAway] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const touchY = useRef<number | null>(null);

  const quickSale = pathname === "/pos";
  const hidden = quickSale || (!open && (away || keyboard));

  useEffect(() => {
    setOpen(false);
    setHelp(false);
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    function onChange() {
      if (media.matches) setOpen(false);
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let last = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      const delta = y - last;
      if (Math.abs(delta) > 8) {
        setAway(delta > 0 && y > 48);
        last = y;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    function measure() {
      const shrunk = viewport ? window.innerHeight - viewport.height > 120 : false;
      const focused = fieldFocused(document.activeElement);
      setKeyboard(shrunk || focused);
    }
    function onFocusIn(event: FocusEvent) {
      if (fieldFocused(event.target)) setKeyboard(true);
    }
    function onFocusOut() {
      window.setTimeout(measure, 40);
    }
    viewport?.addEventListener("resize", measure);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      viewport?.removeEventListener("resize", measure);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, textarea, select")];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (quickSale) return null;

  const homeActive = pathname === "/";
  const billsActive = pathname.startsWith("/invoices");
  const ledgerActive = pathname.startsWith("/customers");
  const moreActive = open || morePaths.some((href) => pathname === href || pathname.startsWith(`${href}/`));

  function locked(feature: string) {
    return Boolean(feature) && Boolean(entitlements) && !featureOn(entitlements, feature);
  }

  return (
    <>
      <div
        inert={hidden ? true : undefined}
        className={`no-print fixed inset-x-3 z-40 md:hidden ${hidden ? "pointer-events-none translate-y-[calc(100%+1.5rem)]" : "translate-y-0"} bottom-[calc(12px+env(safe-area-inset-bottom))] transition-transform duration-200 motion-reduce:transition-none`}
      >
        <nav
          aria-label={t("nav")}
          className="grid grid-cols-5 items-end rounded-[28px] border border-white/70 bg-white/75 px-1 pt-2 pb-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.16)] backdrop-blur-md"
        >
          <Tab href="/" label={t("home")} icon={Home} active={homeActive} />
          <Tab href="/invoices" label={t("bills")} icon={FileText} active={billsActive} />
          <Link
            href="/pos"
            aria-label={t("newBill")}
            onPointerDown={tap}
            className={`${pressable} flex min-h-12 flex-col items-center justify-end gap-1 text-navy`}
          >
            <span className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-emerald text-navy shadow-[0_8px_18px_rgba(16,185,129,0.45)]">
              <Plus size={28} strokeWidth={2.5} aria-hidden />
            </span>
            <span className="max-w-[4.75rem] text-center text-[10px] font-bold leading-tight">{t("newBill")}</span>
          </Link>
          <Tab href="/customers" label={t("ledger")} icon={BookOpen} active={ledgerActive} />
          <button
            ref={moreRef}
            type="button"
            aria-expanded={open}
            aria-controls="more-sheet"
            aria-current={moreActive && !open ? "page" : undefined}
            onPointerDown={tap}
            onClick={() => setOpen(true)}
            className={`${pressable} flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${moreActive ? "text-navy" : "text-slate-500"}`}
          >
            <span className={`flex h-8 items-center rounded-full px-3 ${moreActive ? "bg-emerald/20" : ""}`}>
              <EllipsisIcon filled={moreActive} />
            </span>
            {t("more")}
          </button>
        </nav>
      </div>
      {open ? (
        <div className="no-print fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-navy/40" onClick={() => setOpen(false)} />
          <div
            ref={dialogRef}
            id="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-sheet-title"
            className="pop-sheet absolute inset-x-0 bottom-0 max-h-[min(80vh,640px)] overflow-y-auto rounded-t-3xl bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
            onTouchStart={(event) => {
              if (dialogRef.current && dialogRef.current.scrollTop > 0) {
                touchY.current = null;
                return;
              }
              touchY.current = event.touches[0]?.clientY ?? null;
            }}
            onTouchEnd={(event) => {
              if (touchY.current == null) return;
              const next = event.changedTouches[0]?.clientY ?? touchY.current;
              if (next - touchY.current > 72) setOpen(false);
            }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" aria-hidden />
            <div className="mb-2 flex items-center justify-between">
              <h2 id="more-sheet-title" className="text-lg font-bold">{t("more")}</h2>
              <button ref={closeRef} type="button" className={`${pressable} min-h-12 rounded-full px-4 text-sm font-semibold`} onPointerDown={tap} onClick={() => setOpen(false)}>
                {t("close")}
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {sheetItems.map((item) => {
                const Icon = item.icon;
                const isLocked = locked(item.feature);
                return (
                  <li key={item.href}>
                    <Link href={item.href} onPointerDown={tap} className={`${pressable} flex min-h-12 items-center gap-3 py-2 text-base font-semibold text-navy`}>
                      <Icon size={20} aria-hidden />
                      <span className="flex-1">{t(item.label)}</span>
                      {isLocked ? <Lock size={16} aria-label="Locked" /> : null}
                    </Link>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  aria-expanded={help}
                  onPointerDown={tap}
                  onClick={() => setHelp((value) => !value)}
                  className={`${pressable} flex min-h-12 w-full items-center gap-3 py-2 text-left text-base font-semibold text-navy`}
                >
                  <CircleHelp size={20} aria-hidden />
                  <span className="flex-1">{t("help")}</span>
                </button>
                {help ? <p className="pb-3 pl-8 text-sm text-slate-600">{t("helpBody")}</p> : null}
              </li>
              <li>
                <button
                  type="button"
                  onPointerDown={tap}
                  onClick={() => void getSupabase().auth.signOut().then(() => router.replace("/login"))}
                  className={`${pressable} flex min-h-12 w-full items-center gap-3 py-2 text-left text-base font-semibold text-navy`}
                >
                  <LogOut size={20} aria-hidden />
                  {t("signOut")}
                </button>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Tab({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onPointerDown={tap}
      className={`${pressable} flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-navy" : "text-slate-500"}`}
    >
      <span className={`flex h-8 items-center rounded-full px-3 ${active ? "bg-emerald/20" : ""}`}>
        <Icon size={20} aria-hidden fill={active ? "currentColor" : "none"} strokeWidth={active ? 1.75 : 2} />
      </span>
      {label}
    </Link>
  );
}

function EllipsisIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      {[6, 12, 18].map((cx) => (
        <circle key={cx} cx={cx} cy="12" r={filled ? 2.2 : 1.6} fill="currentColor" />
      ))}
    </svg>
  );
}
