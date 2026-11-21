"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Empty, ErrorNote, Loading, StatusBadge } from "@/components/ui";
import { authed } from "@/lib/api";
import { inr, num } from "@/lib/money";
import type { Invoice, Page, Payment } from "@/lib/types";

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function OverviewPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([
      authed<Page<Invoice>>("/invoices?limit=100"),
      authed<Page<Payment>>("/payments?limit=100"),
    ])
      .then(([invoicePage, paymentPage]) => {
        setInvoices(invoicePage.data);
        setPayments(paymentPage.data);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Loading label="Adding up this month" />;
  if (error) return <ErrorNote message={error} onRetry={load} />;

  const now = new Date();
  const thisMonth = monthKey(now);
  const revenue = payments
    .filter((payment) => payment.status === "succeeded" && payment.paid_at && monthKey(new Date(payment.paid_at)) === thisMonth)
    .reduce((sum, payment) => sum + num(payment.amount), 0);
  const outstanding = invoices.filter((invoice) => invoice.status === "sent").reduce((sum, invoice) => sum + num(invoice.total), 0);
  const overdue = invoices.filter((invoice) => invoice.status === "overdue").reduce((sum, invoice) => sum + num(invoice.total), 0);

  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(date);
    const total = payments
      .filter((payment) => payment.status === "succeeded" && payment.paid_at && monthKey(new Date(payment.paid_at)) === key)
      .reduce((sum, payment) => sum + num(payment.amount), 0);
    return { key, label: date.toLocaleString("en-IN", { month: "short" }), total };
  });
  const peak = Math.max(1, ...months.map((month) => month.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-slate-600">What came in this month, and what is still open.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Revenue this month</p>
          <p className="mt-2 text-2xl font-bold">{inr(revenue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Outstanding</p>
          <p className="mt-2 text-2xl font-bold">{inr(outstanding)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Overdue</p>
          <p className="mt-2 text-2xl font-bold text-amber-800">{inr(overdue)}</p>
        </Card>
      </div>
      <Card>
        <h2 className="font-semibold">Collected, last 6 months</h2>
        {payments.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">Payments will show up here once an invoice is marked paid.</p>
        ) : (
          <div className="mt-6 flex h-40 items-end gap-3" role="img" aria-label="Bar chart of collections by month">
            {months.map((month) => (
              <div key={month.key} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-32 w-full items-end">
                  <div className="w-full rounded-t-lg bg-emerald" style={{ height: `${Math.max(4, (month.total / peak) * 100)}%` }} />
                </div>
                <span className="text-xs text-slate-500">{month.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Recent invoices</h2>
          <Link href="/invoices" className="text-sm font-semibold text-[#0f766e]">
            All invoices
          </Link>
        </div>
        {invoices.length === 0 ? (
          <Empty title="No invoices yet" body="Create the first one when you are ready to bill a customer." />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {invoices.slice(0, 5).map((invoice) => (
              <li key={invoice.id}>
                <Link href={`/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <span>
                    <span className="font-medium">{invoice.number}</span>
                    <span className="ml-2 text-sm text-slate-500">{invoice.customer?.name}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusBadge status={invoice.status} />
                    <span className="text-sm font-semibold">{inr(invoice.total)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
