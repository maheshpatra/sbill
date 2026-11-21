"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LockedFeature } from "@/components/feature-gate";
import { Card, CardSkeleton, Empty, ErrorNote, StatusBadge } from "@/components/ui";
import { authed } from "@/lib/api";
import { inr, inrTight, num } from "@/lib/money";
import type { Invoice, Page, Payment } from "@/lib/types";

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function OverviewPage() {
  const t = useTranslations("home");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [morning, setMorning] = useState<{
    yesterday: { sales: number; invoice_count: number };
    top_dues: Array<{ customer_id: string; name: string; balance: number }>;
    low_stock: Array<{ product_id: string; name: string; stock: number }>;
    series_7d: Array<{ date: string; sales: number }>;
  } | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([
      authed<Page<Invoice>>("/invoices?limit=100"),
      authed<Page<Payment>>("/payments?limit=100"),
      authed<{
        yesterday: { sales: number; invoice_count: number };
        top_dues: Array<{ customer_id: string; name: string; balance: number }>;
        low_stock: Array<{ product_id: string; name: string; stock: number }>;
        series_7d: Array<{ date: string; sales: number }>;
      }>("/dashboard/morning").catch(() => null),
    ])
      .then(([invoicePage, paymentPage, morningPage]) => {
        setInvoices(invoicePage.data);
        setPayments(paymentPage.data);
        setMorning(morningPage);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <CardSkeleton cards={4} />;
  if (error) return <ErrorNote message={error} onRetry={load} />;

  const now = new Date();
  const today = now.toDateString();
  const sales = payments
    .filter((payment) => payment.status === "succeeded" && payment.paid_at && new Date(payment.paid_at).toDateString() === today)
    .reduce((sum, payment) => sum + num(payment.amount), 0);
  const outstanding = morning
    ? (morning.top_dues ?? []).reduce((sum, row) => sum + num(row.balance), 0)
    : invoices
        .filter((invoice) => invoice.status === "sent" || invoice.status === "overdue" || invoice.status === "partially_paid")
        .reduce((sum, invoice) => sum + num(invoice.total), 0);
  const received = payments.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + num(payment.amount), 0);

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
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <Link
        href="/pos"
        className="flex min-h-36 flex-col items-start justify-center rounded-[28px] bg-emerald px-6 py-8 text-navy shadow-sm active:bg-teal"
      >
        <span className="text-4xl font-bold tracking-tight sm:text-5xl">{t("newBill")}</span>
        <span className="mt-2 text-base">{t("newBillHint")}</span>
      </Link>
      {morning ? (
        <Card>
          <h2 className="font-semibold">{t("morning")}</h2>
          <p className="mt-2 text-sm text-slate-600">{t("yesterday")}</p>
          <p className="text-2xl font-bold">{inr(morning.yesterday?.sales ?? 0)}</p>
          <p className="mt-3 text-sm text-slate-600">{t("dues")}</p>
          {morning.top_dues?.length ? (
            <ul className="mt-1 text-sm">
              {morning.top_dues.map((row) => (
                <li key={row.customer_id} className="flex justify-between gap-3 py-1">
                  <span>{row.name}</span>
                  <span className="font-semibold">{inr(row.balance)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">{t("noDues")}</p>
          )}
          {morning.low_stock?.length ? (
            <p className="mt-3 text-sm">{t("lowStock")}: {morning.low_stock.map((row) => `${row.name} (${row.stock})`).join(", ")}</p>
          ) : null}
        </Card>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Card className="min-w-0 p-3 sm:p-5">
          <p className="text-xs text-slate-500 sm:text-sm">{t("sales")}</p>
          <p className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{inrTight(sales)}</p>
        </Card>
        <Card className="min-w-0 p-3 sm:p-5">
          <p className="text-xs text-slate-500 sm:text-sm">{t("outstanding")}</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-amber-800 sm:text-xl">{inrTight(outstanding)}</p>
        </Card>
        <Card className="col-span-2 min-w-0 p-3 sm:col-span-1 sm:p-5">
          <p className="text-xs text-slate-500 sm:text-sm">{t("received")}</p>
          <p className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{inrTight(received)}</p>
        </Card>
      </div>
      <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">{t("more")}</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/invoices" className="rounded-full bg-[#f4f6f5] px-4 py-2 text-sm font-semibold">{t("bills")}</Link>
          <Link href="/customers" className="rounded-full bg-[#f4f6f5] px-4 py-2 text-sm font-semibold">{t("customers")}</Link>
          <Link href="/products" className="rounded-full bg-[#f4f6f5] px-4 py-2 text-sm font-semibold">{t("goods")}</Link>
        </div>
      </details>
      <LockedFeature feature="reporting_dashboard" label={t("chart")}>
        <div id="reports">
        <Card>
          <h2 className="font-semibold">{t("chart")}</h2>
          {payments.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">{t("chartEmpty")}</p>
          ) : (
            <div className="mt-6 flex h-40 items-end gap-3" role="img" aria-label={t("chart")}>
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
        </div>
      </LockedFeature>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t("recent")}</h2>
          <Link href="/invoices" className="text-sm font-semibold text-[#0f766e]">{t("allBills")}</Link>
        </div>
        {invoices.length === 0 ? (
          <Empty title={t("empty")} body={t("emptyBody")} />
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
