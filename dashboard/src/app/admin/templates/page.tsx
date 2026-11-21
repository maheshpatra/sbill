"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { authed } from "@/lib/api";

interface Row {
  key: string;
  name: string;
  description?: string | null;
  required_feature?: string | null;
  active: boolean;
}

export default function AdminTemplatesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Row | null>(null);

  function load() {
    void authed<{ data: Row[] }>("/admin/templates")
      .then((page) => setRows(page.data ?? []))
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
  }, []);

  function save(row: Row, active: boolean) {
    void authed(`/admin/templates/${row.key}`, {
      method: "PUT",
      body: JSON.stringify({ name: row.name, description: row.description, required_feature: row.required_feature, active }),
    }).then(() => load()).catch((reason: Error) => setError(reason.message));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Invoice templates</h1>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              <span className="font-semibold">{row.name}</span>
              <span className="ml-2 text-slate-500">{row.required_feature || "every plan"}</span>
            </span>
            <button type="button" className="rounded-full border border-slate-300 px-3 py-2" onClick={() => (row.active ? setPending(row) : save(row, true))}>
              {row.active ? "Disable" : "Enable"}
            </button>
          </li>
        ))}
      </ul>
      {pending ? (
        <ConfirmDialog
          title={`Disable ${pending.name}?`}
          body="Shops that use it will fall back to Classic."
          confirm="Disable"
          onClose={() => setPending(null)}
          onConfirm={() => { save(pending, false); setPending(null); }}
        />
      ) : null}
    </div>
  );
}
