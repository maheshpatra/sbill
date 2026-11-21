"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ListSkeleton } from "@/components/ui";
import { authed } from "@/lib/api";
import type { Plan } from "@/lib/types";

interface Flag {
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
}

export default function AdminFlagsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [code, setCode] = useState("growth");
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Flag | null>(null);

  useEffect(() => {
    void authed<{ data: Plan[] }>("/admin/plans").then((page) => setPlans(page.data ?? [])).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    void authed<{ data: Flag[] }>(`/admin/plans/${code}/features`)
      .then((page) => setFlags(page.data ?? []))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [code]);

  function save(next: Flag[]) {
    void authed(`/admin/plans/${code}/features`, { method: "PUT", body: JSON.stringify({ features: next }) })
      .then(() => setFlags(next))
      .catch((reason: Error) => setError(reason.message));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Feature flags</h1>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <label className="text-sm">
        Plan
        <select className="ml-2 rounded-full border border-slate-300 px-3 py-2" value={code} onChange={(event) => setCode(event.target.value)}>
          {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
        </select>
      </label>
      {loading ? <ListSkeleton rows={8} /> : (
      <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {flags.map((flag) => (
          <li key={flag.feature_key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="font-semibold">{flag.feature_key.replaceAll("_", " ")}</span>
            <button type="button" className="rounded-full border border-slate-300 px-3 py-2" onClick={() => (flag.enabled ? setPending(flag) : save(flags.map((item) => item.feature_key === flag.feature_key ? { ...item, enabled: true } : item)))}>
              {flag.enabled ? "On" : "Off"}
            </button>
          </li>
        ))}
      </ul>
      )}
      {pending ? (
        <ConfirmDialog
          title={`Turn off ${pending.feature_key}?`}
          body={`${code} would no longer include this feature.`}
          confirm="Turn off"
          onClose={() => setPending(null)}
          onConfirm={() => {
            save(flags.map((item) => item.feature_key === pending.feature_key ? { ...item, enabled: false } : item));
            setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}
