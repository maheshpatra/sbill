"use client";

import { Lock } from "lucide-react";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { requiredPlanName } from "@/lib/plans";

export function FeatureBanner({ feature, label }: { feature: string; label: string }) {
  const { entitlements, showUpgrade } = useEntitlements();
  if (!entitlements || featureOn(entitlements, feature)) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="flex items-center gap-2">
        <Lock size={14} aria-hidden />
        {label} unlocks on the {requiredPlanName(feature)} plan. You can still look through this page.
      </p>
      <button type="button" className="rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white" onClick={() => showUpgrade(feature)}>
        Upgrade
      </button>
    </div>
  );
}

/** Plan-gated UI stays on screen. A lock and an upgrade prompt sit above it. */
export function LockedFeature({
  feature,
  label,
  children,
}: {
  feature: string;
  label: string;
  children: React.ReactNode;
}) {
  const { entitlements, showUpgrade } = useEntitlements();
  const locked = Boolean(entitlements) && !featureOn(entitlements, feature);
  return (
    <div>
      {locked ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="flex items-center gap-2">
            <Lock size={14} aria-hidden />
            <span>
              <strong>{label}</strong> is included on the {requiredPlanName(feature)} plan.
            </span>
          </p>
          <button type="button" className="rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white" onClick={() => showUpgrade(feature)}>
            Upgrade
          </button>
        </div>
      ) : null}
      <div className={locked ? "rounded-2xl" : undefined} aria-disabled={locked || undefined}>
        {children}
      </div>
    </div>
  );
}
