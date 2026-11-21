"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { authed } from "@/lib/api";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { readLogo } from "@/lib/brand-assets";
import { BENGALI_SAMPLE, TEMPLATES, isTemplateKey, type TemplateKey } from "@/lib/templates";

export default function TemplateGalleryPage() {
  const { entitlements } = useEntitlements();
  const [logo, setLogo] = useState<string | null>(null);
  const [active, setActive] = useState<TemplateKey>("classic");
  const [catalog, setCatalog] = useState<Array<{ key: string; name: string; entitled?: boolean; required_feature?: string | null }>>([]);

  useEffect(() => {
    setLogo(readLogo());
    void authed<{ data: Array<{ key: string; name: string; entitled?: boolean; required_feature?: string | null }> }>("/invoice-templates")
      .then((page) => setCatalog(page.data ?? []))
      .catch(() => setCatalog(TEMPLATES.map((item) => ({ key: item.key, name: item.name, required_feature: item.feature || null }))));
  }, []);

  const chips = (catalog.length ? catalog : TEMPLATES.map((item) => ({ key: item.key, name: item.name, required_feature: item.feature || null }))).filter((item) => isTemplateKey(item.key));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Invoice templates</h1>
        <p className="mt-1 text-sm text-slate-600">Previews use a sample bill. Classic is included. The others follow your plan.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {chips.map((item) => {
          const key = item.key as TemplateKey;
          const entitled = "entitled" in item ? item.entitled : undefined;
          const feature = item.required_feature || "";
          const locked = entitled === false || (entitled === undefined && Boolean(feature) && Boolean(entitlements) && !featureOn(entitlements, feature));
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active === key}
              className={`flex min-h-12 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold ${active === key ? "bg-navy text-white" : "bg-white"}`}
              onClick={() => setActive(key)}
            >
              {item.name}
              {locked ? <Lock size={14} aria-label="Locked" /> : null}
            </button>
          );
        })}
      </div>
      <InvoiceSheet template={active} invoice={active === "bengali" ? BENGALI_SAMPLE : undefined} logo={logo} />
      <p className="text-sm">
        <Link className="font-semibold underline" href="/proof">Bengali type proof</Link>
      </p>
    </div>
  );
}
