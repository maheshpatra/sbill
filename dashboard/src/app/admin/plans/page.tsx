"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CardSkeleton, ErrorNote } from "@/components/ui";
import { authed } from "@/lib/api";
import { inr } from "@/lib/money";
import type { Plan } from "@/lib/types";

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Plan | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    void authed<{ data: Plan[] }>("/admin/plans")
      .then((page) => setPlans(page.data ?? []))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const draft = pending ? prices[pending.id] ?? String(pending.price_monthly) : "";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Plans and prices</h1>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm text-navy">{notice}</p> : null}
      {loading && plans.length === 0 ? <CardSkeleton cards={4} /> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="font-semibold">{plan.name}</p>
            <p className="text-sm text-slate-500">{plan.code}</p>
            <p className="mt-2">{inr(plan.price_monthly)} / month · {inr(plan.price_yearly)} / year</p>
            <label className="mt-3 block text-sm">
              Monthly
              <input
                className="ml-2 w-28 rounded-lg border border-slate-300 px-2 py-1"
                inputMode="decimal"
                value={prices[plan.id] ?? String(plan.price_monthly)}
                onChange={(event) => setPrices((current) => ({ ...current, [plan.id]: event.target.value }))}
              />
            </label>
            <button
              type="button"
              className="mt-3 rounded-full border border-slate-300 px-3 py-2 text-sm"
              onClick={() => {
                setDialogError(null);
                setPending(plan);
              }}
            >
              Save monthly price
            </button>
          </li>
        ))}
      </ul>
      {pending ? (
        <ConfirmDialog
          title={`Change ${pending.name}?`}
          body={`Monthly price becomes ${draft || pending.price_monthly}.`}
          confirm="Save price"
          pending={saving}
          error={dialogError}
          onClose={() => {
            if (saving) return;
            setPending(null);
            setDialogError(null);
          }}
          onConfirm={() => {
            const price = Number(draft);
            if (!Number.isFinite(price) || price < 0) {
              setDialogError("Enter a monthly price of zero or more.");
              return;
            }
            setSaving(true);
            setDialogError(null);
            void authed(`/admin/plans/${pending.code}`, { method: "PATCH", body: JSON.stringify({ price_monthly: price }) })
              .then(() => {
                setPrices((current) => {
                  const next = { ...current };
                  delete next[pending.id];
                  return next;
                });
                setPending(null);
                setNotice(`${pending.name} is now ${inr(price)} a month.`);
                load();
              })
              .catch((reason: Error) => setDialogError(reason.message))
              .finally(() => setSaving(false));
          }}
        />
      ) : null}
    </div>
  );
}
