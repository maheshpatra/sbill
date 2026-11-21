"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { authed } from "@/lib/api";
import { inr } from "@/lib/money";
import type { Plan } from "@/lib/types";

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Plan | null>(null);
  const [price, setPrice] = useState("");

  function load() {
    void authed<{ data: Plan[] }>("/admin/plans")
      .then((page) => setPlans(page.data ?? []))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Plans and prices</h1>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="font-semibold">{plan.name}</p>
            <p className="text-sm text-slate-500">{plan.code}</p>
            <p className="mt-2">{inr(plan.price_monthly)} / month · {inr(plan.price_yearly)} / year</p>
            <label className="mt-3 block text-sm">
              Monthly
              <input className="ml-2 w-28 rounded-lg border border-slate-300 px-2 py-1" value={pending?.id === plan.id ? price : String(plan.price_monthly)} onChange={(event) => { setPending(plan); setPrice(event.target.value); }} />
            </label>
            <button type="button" className="mt-3 rounded-full border border-slate-300 px-3 py-2 text-sm" onClick={() => { setPending(plan); setPrice((current) => current || String(plan.price_monthly)); }}>
              Save monthly price
            </button>
          </li>
        ))}
      </ul>
      {pending ? (
        <ConfirmDialog
          title={`Change ${pending.name}?`}
          body={`Monthly price becomes ${price || pending.price_monthly}.`}
          confirm="Save price"
          onClose={() => setPending(null)}
          onConfirm={() => {
            void authed(`/admin/plans/${pending.code}`, { method: "PATCH", body: JSON.stringify({ price_monthly: Number(price) }) })
              .then(() => { setPending(null); load(); })
              .catch((reason: Error) => setError(reason.message));
          }}
        />
      ) : null}
    </div>
  );
}
