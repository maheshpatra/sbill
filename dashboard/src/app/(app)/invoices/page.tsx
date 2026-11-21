"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Empty, ErrorNote, Loading, StatusBadge, inputClass } from "@/components/ui";
import { authed } from "@/lib/api";
import { canWrite } from "@/lib/access";
import { inr } from "@/lib/money";
import type { Invoice, InvoiceStatus, Me, Page } from "@/lib/types";

const statuses: Array<InvoiceStatus | ""> = ["", "draft", "sent", "paid", "overdue", "void"];

export default function InvoicesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Page<Invoice> | null>(null);
  const [role, setRole] = useState<Me["user"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (status) params.set("status", status);
    if (query) params.set("q", query);
    Promise.all([authed<Page<Invoice>>(`/invoices?${params}`), authed<Me>("/auth/me")])
      .then(([invoicePage, me]) => {
        setRows(invoicePage);
        setRole(me.user);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, query]);

  const pages = Math.max(1, Math.ceil((rows?.total ?? 0) / 20));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        {canWrite(role?.role) ? (
          <Link href="/invoices/new" className="rounded-full bg-emerald px-4 py-2 text-sm font-semibold text-navy">
            New invoice
          </Link>
        ) : null}
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(q);
        }}
      >
        <label className="sr-only" htmlFor="invoice-search">Search invoice number</label>
        <input id="invoice-search" className={inputClass} placeholder="Search by number" value={q} onChange={(event) => setQ(event.target.value)} />
        <label className="sr-only" htmlFor="invoice-status">Status</label>
        <select
          id="invoice-status"
          className={inputClass}
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value as InvoiceStatus | "");
          }}
        >
          {statuses.map((value) => (
            <option key={value || "all"} value={value}>
              {value ? value : "All statuses"}
            </option>
          ))}
        </select>
        <Button type="submit" variant="navy">Search</Button>
      </form>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {loading ? <Loading /> : null}
      {!loading && rows && rows.data.length === 0 ? (
        <Empty title="Nothing matches" body="Try another status, or create an invoice for a customer." />
      ) : null}
      {!loading && rows && rows.data.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((invoice) => (
                <tr key={invoice.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link className="font-semibold text-navy underline" href={`/invoices/${invoice.id}`}>
                      {invoice.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{invoice.customer?.name ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={invoice.status} /></td>
                  <td className="px-4 py-3">{inr(invoice.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex items-center justify-between text-sm">
        <p>Page {page} of {pages}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <Button type="button" variant="outline" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
