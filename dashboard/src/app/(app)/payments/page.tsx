"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Empty, ErrorNote, Loading } from "@/components/ui";
import { authed } from "@/lib/api";
import { inr } from "@/lib/money";
import type { Page, Payment } from "@/lib/types";

export default function PaymentsPage() {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Page<Payment> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    authed<Page<Payment>>(`/payments?page=${page}&limit=20`)
      .then(setRows)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const pages = Math.max(1, Math.ceil((rows?.total ?? 0) / 20));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {loading ? <Loading /> : null}
      {!loading && rows?.data.length === 0 ? <Empty title="No payments yet" body="Mark an invoice paid and it will land here." /> : null}
      {!loading && rows && rows.data.length > 0 ? (
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm">
          {rows.data.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <Link className="font-semibold underline" href={`/invoices/${payment.invoice_id}`}>Invoice</Link>
                <p className="capitalize text-slate-500">{payment.method.replaceAll("_", " ")} · {payment.status}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{inr(payment.amount)}</p>
                <p className="text-xs text-slate-500">{payment.paid_at ? new Date(payment.paid_at).toLocaleDateString("en-IN") : ""}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
        <Button type="button" variant="outline" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
      </div>
    </div>
  );
}
