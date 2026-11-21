"use client";

import { useEffect, useState } from "react";
import { authed } from "@/lib/api";

interface EventRow {
  id: string;
  kind: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

export function InvoiceEvents({ invoiceId }: { invoiceId: string }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void authed<{ data: EventRow[] }>(`/invoices/${invoiceId}/events`)
      .then((page) => setRows(page.data ?? []))
      .catch((reason: Error) => setError(reason.message));
  }, [invoiceId]);

  if (error) return <p className="text-sm text-slate-500">{error}</p>;
  if (!rows.length) return null;
  return (
    <ol className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
          <span className="font-semibold capitalize">{row.kind.replaceAll("_", " ")}</span>
          <span className="text-slate-500">{new Date(row.created_at).toLocaleString("en-IN")}</span>
        </li>
      ))}
    </ol>
  );
}
