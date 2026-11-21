"use client";

import { Lock } from "lucide-react";
import { featureOn, useEntitlements } from "@/lib/entitlements";

const REQUIRED: Record<string, string> = {
  gst_invoices: "Starter",
  product_catalog: "Starter",
  whatsapp_click_to_chat: "Starter",
  auto_reminders: "Growth",
  online_payments: "Growth",
  pos: "Growth",
  reporting_dashboard: "Growth",
  custom_templates: "Business",
  custom_domains: "Business",
  whatsapp_sharing: "Business",
};

export function FeatureBanner({ feature, label }: { feature: string; label: string }) {
  const { entitlements, showUpgrade } = useEntitlements();
  if (!entitlements || featureOn(entitlements, feature)) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="flex items-center gap-2">
        <Lock size={14} aria-hidden />
        {label} unlocks on the {REQUIRED[feature] ?? "next"} plan. You can still look through this page.
      </p>
      <button type="button" className="rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white" onClick={() => showUpgrade(feature)}>
        Upgrade
      </button>
    </div>
  );
}
