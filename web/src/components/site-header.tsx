"use client";

import { useState } from "react";
import { dashboardLinks } from "@/lib/links";

const links = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader() {
  const { signup, login } = dashboardLinks();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#f7f8f6]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 rounded-md">
          <img
            src="/brand/billflow-logo-horizontal.svg"
            alt="billflow"
            width={168}
            height={34}
          />
        </a>
        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-700 md:flex" aria-label="Page">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-navy">
              {link.label}
            </a>
          ))}
          <a href={login} className="hover:text-navy">
            Sign in
          </a>
          <a
            href={signup}
            className="rounded-full bg-emerald px-4 py-2 font-semibold text-navy hover:bg-teal"
          >
            Start free
          </a>
        </nav>
        <button
          type="button"
          className="rounded-md px-3 py-2 text-sm font-semibold md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <nav id="mobile-nav" className="flex flex-col gap-1 border-t border-slate-200 px-4 py-3 md:hidden" aria-label="Page">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="rounded-md px-2 py-2" onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href={login} className="rounded-md px-2 py-2">
            Sign in
          </a>
          <a href={signup} className="mt-1 rounded-full bg-emerald px-4 py-2 text-center font-semibold text-navy">
            Start free
          </a>
        </nav>
      ) : null}
    </header>
  );
}
