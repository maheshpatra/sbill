"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { callBillflow, setApiErrorListener, type ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { requiredPlanName } from "@/lib/plans";
import type { Entitlements, Plan } from "@/lib/types";

export interface UpgradePrompt {
  feature?: string;
  code?: string;
  message?: string;
  requiredPlan?: string;
}

interface EntitlementState {
  entitlements: Entitlements | null;
  plans: Plan[];
  loading: boolean;
  showUpgrade: (feature: string, extra?: Partial<UpgradePrompt>) => void;
  refresh: () => void;
}

const Ctx = createContext<EntitlementState>({
  entitlements: null,
  plans: [],
  loading: false,
  showUpgrade: () => undefined,
  refresh: () => undefined,
});

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState<UpgradePrompt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setApiErrorListener((error: ApiError) => {
      setPrompt({
        feature: error.feature,
        code: error.code,
        message: error.message,
        requiredPlan: error.requiredPlan,
      });
    });
    return () => setApiErrorListener(null);
  }, []);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    setLoading(true);
    const token = session.access_token;
    Promise.all([
      callBillflow<Entitlements>((client) => client.GET("/entitlements", { parseAs: "json" }), token),
      callBillflow<{ data: Plan[] }>((client) => client.GET("/billing/plans", { parseAs: "json" }), token),
    ])
      .then(([next, catalog]) => {
        if (cancelled) return;
        setEntitlements(next);
        setPlans(catalog.data ?? []);
      })
      .catch((reason: Error) => {
        if (!cancelled) setLoadError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, tick]);

  const feature = prompt?.feature;
  const planName = requiredPlanName(feature ?? "", prompt?.requiredPlan);
  const limit = prompt?.code === "LIMIT_REACHED";

  return (
    <Ctx.Provider
      value={{
        entitlements,
        plans,
        loading,
        showUpgrade: (next, extra) => setPrompt({ feature: next, ...extra }),
        refresh: () => setTick((value) => value + 1),
      }}
    >
      {loadError ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950" role="status">
          Plan details did not load, so locks stay off until they do. {loadError}
        </p>
      ) : null}
      {children}
      {prompt ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="upgrade-title" className="font-heading text-lg font-semibold text-navy">
              {limit ? "This plan limit is full" : `${(feature ?? "This").replaceAll("_", " ")} is on the ${planName} plan`}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {prompt.message ||
                (limit
                  ? "You can keep what you already have. New records wait until you upgrade or free a slot."
                  : "The screen stays available so you can see how it works. Saving and sending wait until the plan includes it.")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-full px-4 py-2 text-sm font-semibold text-navy" onClick={() => setPrompt(null)}>
                Close
              </button>
              <Link href="/billing" className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white" onClick={() => setPrompt(null)}>
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
  if (!entitlements) return false;
  const value = entitlements.features?.[feature];
  // These ship on Free. Older payloads omit cash_payments even when it is on.
  if (value === undefined && (feature === "cash_payments" || feature === "upi_qr" || feature === "basic_invoices" || feature === "public_site")) {
    return true;
  }
  return value === true;
}
