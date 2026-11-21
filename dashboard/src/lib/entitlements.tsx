"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { authed } from "@/lib/api";
import type { Entitlements, Plan } from "@/lib/types";

const REQUIRED: Record<string, string> = {
  gst_invoices: "Starter",
  product_catalog: "Starter",
  whatsapp_click_to_chat: "Starter",
  upi_qr: "Free",
  auto_reminders: "Growth",
  online_payments: "Growth",
  pos: "Growth",
  multi_user_roles: "Growth",
  stock_tracking: "Growth",
  reporting_dashboard: "Growth",
  custom_templates: "Business",
  custom_domains: "Business",
  whatsapp_sharing: "Business",
};

interface EntitlementState {
  entitlements: Entitlements | null;
  plans: Plan[];
  showUpgrade: (feature: string) => void;
}

const Ctx = createContext<EntitlementState>({ entitlements: null, plans: [], showUpgrade: () => undefined });

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [feature, setFeature] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([authed<Entitlements>("/entitlements"), authed<{ data: Plan[] }>("/billing/plans")])
      .then(([next, catalog]) => {
        setEntitlements(next);
        setPlans(catalog.data);
      })
      .catch(() => undefined);
  }, [session]);

  const planName = feature ? REQUIRED[feature] ?? "a higher" : "";

  return (
    <Ctx.Provider value={{ entitlements, plans, showUpgrade: setFeature }}>
      {children}
      {feature ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="upgrade-title" className="text-lg font-semibold text-navy">
              {feature.replaceAll("_", " ")} is on the {planName} plan
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              The screen stays available so you can see how it works. Saving and sending wait until the plan includes it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-full px-4 py-2 text-sm font-semibold text-navy" onClick={() => setFeature(null)}>
                Close
              </button>
              <Link href="/billing" className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white" onClick={() => setFeature(null)}>
                Compare plans
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export function useEntitlements() {
  return useContext(Ctx);
}

export function featureOn(entitlements: Entitlements | null, feature: string) {
  return entitlements?.features?.[feature] === true;
}
