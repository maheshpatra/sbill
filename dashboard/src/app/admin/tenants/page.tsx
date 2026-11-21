"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { authed } from "@/lib/api";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
}

export default function AdminTenantsPage() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<TenantRow | null>(null);
  const [planFor, setPlanFor] = useState<TenantRow | null>(null);
  const [plan, setPlan] = useState("growth");

  function load() {
    void authed<{ data: TenantRow[] }>("/admin/tenants")
      .then((page) => setRows(page.data ?? []))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Tenants</h1>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="font-semibold">{row.name}</p>
            <p className="text-sm text-slate-500">{row.slug} · {row.plan} · {row.status}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded-full border border-slate-300 px-3 py-2 text-sm" onClick={() => setPending(row)}>
                {row.status === "suspended" ? "Reactivate" : "Suspend"}
              </button>
              <button type="button" className="rounded-full bg-navy px-3 py-2 text-sm text-white" onClick={() => { setPlanFor(row); setPlan(row.plan); }}>
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
          onClose={() => setPending(null)}
          onConfirm={() => {
            const status = pending.status === "suspended" ? "active" : "suspended";
            void authed(`/admin/tenants/${pending.id}/suspend`, { method: "POST", body: JSON.stringify({ status }) })
              .then(() => { setPending(null); load(); })
              .catch((reason: Error) => setError(reason.message));
          }}
        />
      ) : null}
      {planFor ? (
        <ConfirmDialog
          title={`Move ${planFor.name} to ${plan}?`}
          body="The plan change applies as soon as you confirm."
          confirm="Change plan"
          onClose={() => setPlanFor(null)}
          onConfirm={() => {
            void authed(`/admin/tenants/${planFor.id}/plan`, { method: "POST", body: JSON.stringify({ plan }) })
              .then(() => { setPlanFor(null); load(); })
              .catch((reason: Error) => setError(reason.message));
          }}
        />
      ) : null}
      {planFor ? (
        <label className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm shadow">
          Plan
          <select className="ml-2" value={plan} onChange={(event) => setPlan(event.target.value)} aria-label="New plan">
            {["free", "starter", "growth", "business"].map((code) => <option key={code}>{code}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}
