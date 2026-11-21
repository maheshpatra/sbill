"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorNote, ListSkeleton, inputClass } from "@/components/ui";
import { authed } from "@/lib/api";
import type { Plan } from "@/lib/types";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
}

const fallbackPlans = ["free", "starter", "growth", "business"];

export default function AdminTenantsPage() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<Array<{ code: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<TenantRow | null>(null);
  const [planFor, setPlanFor] = useState<TenantRow | null>(null);
  const [plan, setPlan] = useState("growth");

  function load() {
    setLoading(true);
    Promise.all([
      authed<{ data: TenantRow[] }>("/admin/tenants"),
      authed<{ data: Plan[] }>("/admin/plans").catch(() => ({ data: [] as Plan[] })),
    ])
      .then(([page, planPage]) => {
        setRows(page.data ?? []);
        setPlans((planPage.data ?? []).map((row) => ({ code: row.code, name: row.name })));
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const options = plans.length ? plans : fallbackPlans.map((code) => ({ code, name: code }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Tenants</h1>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm text-navy">{notice}</p> : null}
      {loading && rows.length === 0 ? <ListSkeleton rows={5} /> : null}
      {!loading && rows.length === 0 ? <p className="text-sm text-slate-600">No tenants yet.</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="font-semibold">{row.name}</p>
            <p className="text-sm text-slate-500">{row.slug} · {row.plan} · {row.status}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded-full border border-slate-300 px-3 py-2 text-sm" onClick={() => setPending(row)}>
                {row.status === "suspended" ? "Reactivate" : "Suspend"}
              </button>
              <button
                type="button"
                className="rounded-full bg-navy px-3 py-2 text-sm text-white"
                onClick={() => {
                  setDialogError(null);
                  setPlanFor(row);
                  setPlan(options.some((item) => item.code === row.plan) ? row.plan : options[0]?.code ?? row.plan);
                }}
              >
                Change plan
              </button>
            </div>
          </li>
        ))}
      </ul>
      {pending ? (
        <ConfirmDialog
          title={pending.status === "suspended" ? `Reactivate ${pending.name}?` : `Suspend ${pending.name}?`}
          body={pending.status === "suspended" ? "The business can sign in and bill again." : "People in this business will not be able to bill until you reactivate it."}
          confirm={pending.status === "suspended" ? "Reactivate" : "Suspend"}
          pending={saving}
          error={dialogError}
          onClose={() => {
            if (saving) return;
            setPending(null);
            setDialogError(null);
          }}
          onConfirm={() => {
            const status = pending.status === "suspended" ? "active" : "suspended";
            setSaving(true);
            setDialogError(null);
            void authed(`/admin/tenants/${pending.id}/suspend`, { method: "POST", body: JSON.stringify({ status }) })
              .then(() => {
                setPending(null);
                setNotice(`${pending.name} is ${status}.`);
                load();
              })
              .catch((reason: Error) => setDialogError(reason.message))
              .finally(() => setSaving(false));
          }}
        />
      ) : null}
      {planFor ? (
        <ConfirmDialog
          title={`Change plan for ${planFor.name}`}
          body={`Current plan is ${planFor.plan}. The new plan applies as soon as you confirm.`}
          confirm="Change plan"
          pending={saving}
          error={dialogError}
          onClose={() => {
            if (saving) return;
            setPlanFor(null);
            setDialogError(null);
          }}
          onConfirm={() => {
            setSaving(true);
            setDialogError(null);
            void authed(`/admin/tenants/${planFor.id}/plan`, { method: "POST", body: JSON.stringify({ plan }) })
              .then(() => {
                setPlanFor(null);
                setNotice(`${planFor.name} is now on ${plan}.`);
                load();
              })
              .catch((reason: Error) => setDialogError(reason.message))
              .finally(() => setSaving(false));
          }}
        >
          <label className="block text-sm font-medium text-navy">
            New plan
            <select className={`${inputClass} mt-1.5`} value={plan} onChange={(event) => setPlan(event.target.value)} aria-label="New plan">
              {options.map((item) => (
                <option key={item.code} value={item.code}>{item.name} ({item.code})</option>
              ))}
            </select>
          </label>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
