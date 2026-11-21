"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildUpiUri } from "@billflow/upi";
import { CashPanel, PayMethodTabs } from "@/components/cash-panel";
import { LockedFeature } from "@/components/feature-gate";
import { OnlineActions, PaymentLinkPanel, openTenantCheckout, type RazorpayLinkStart, type RazorpayStart } from "@/components/online-panel";
import { Button, Empty, ErrorNote, Field, Loading, inputClass } from "@/components/ui";
import { authed } from "@/lib/api";
import { rememberPayMethod, rememberedPayMethod, type PayMethod } from "@/lib/cash";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { inr, num } from "@/lib/money";
import type { Invoice, Page, Payment, Tenant } from "@/lib/types";

const openStatus = new Set(["sent", "overdue", "partially_paid", "draft"]);

export default function PaymentsPage() {
  const { entitlements, showUpgrade } = useEntitlements();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [method, setMethod] = useState<PayMethod>("upi");
  const [amount, setAmount] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [qr, setQr] = useState<{ payment_id: string; upi_uri: string; qr_svg: string; amount: number | string; tr: string } | null>(null);
  const [utr, setUtr] = useState("");
  const [link, setLink] = useState<RazorpayLinkStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  function load() {
    setLoading(true);
    Promise.all([
      authed<Page<Invoice>>("/invoices?limit=100"),
      authed<Page<Payment>>(`/payments?page=${page}&limit=20`),
      authed<Tenant>("/tenants/current"),
      authed<{ connected: boolean }>("/settings/razorpay").catch(() => ({ connected: false })),
    ])
      .then(([invoicePage, paymentPage, nextTenant, razorpay]) => {
        setInvoices(invoicePage.data);
        setPayments(paymentPage.data);
        setTenant(nextTenant);
        setConnected(razorpay.connected);
        setInvoiceId((current) => current || invoicePage.data.find((row) => openStatus.has(row.status))?.id || invoicePage.data[0]?.id || "");
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const saved = rememberedPayMethod();
    if (saved === "upi" || saved === "cash" || saved === "online") setMethod(saved);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const invoice = invoices.find((row) => row.id === invoiceId) ?? null;
  const received = useMemo(
    () => payments.filter((row) => row.invoice_id === invoiceId && row.status === "succeeded").reduce((sum, row) => sum + num(row.amount), 0),
    [payments, invoiceId],
  );
  const due = invoice ? Math.max(0, num(invoice.total) - received) : 0;
  const onlineLocked = Boolean(entitlements) && !featureOn(entitlements, "online_payments");
  const upiReady = Boolean(tenant?.upi_vpa && tenant.upi_payee_name);

  useEffect(() => {
    if (invoice) setAmount(String(due || num(invoice.total)));
  }, [invoiceId, due, invoice]);

  async function collectUpi() {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authed<typeof qr & object>(`/invoices/${invoice.id}/upi`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount) || due }),
      });
      setQr(result);
      rememberPayMethod("upi");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the UPI QR");
    } finally {
      setBusy(false);
    }
  }

  async function confirmUpi() {
    if (!qr) return;
    setBusy(true);
    setError(null);
    try {
      await authed(`/payments/${qr.payment_id}/confirm`, { method: "POST", body: JSON.stringify(utr ? { utr } : {}) });
      setQr(null);
      setUtr("");
      setNotice("Payment received.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment was not confirmed");
    } finally {
      setBusy(false);
    }
  }

  async function recordCash(value: { tendered: number; changeGiven: number; applied: number }) {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      await authed("/payments", {
        method: "POST",
        body: JSON.stringify({
          invoice_id: invoice.id,
          amount: value.applied,
          method: "cash",
          amount_tendered: value.tendered,
          change_given: value.changeGiven,
        }),
      });
      rememberPayMethod("cash");
      setNotice(`Cash recorded. Change ${inr(value.changeGiven)}.`);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cash was not recorded");
    } finally {
      setBusy(false);
    }
  }

  async function startOnline(mode: "checkout" | "link") {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authed<RazorpayStart>(`/invoices/${invoice.id}/razorpay`, {
        method: "POST",
        body: JSON.stringify({ mode, amount: Number(amount) || due }),
      });
      rememberPayMethod("online");
      if (result.mode === "checkout") {
        const paid = await openTenantCheckout(result);
        await authed(`/payments/${result.payment_id}/razorpay/verify`, {
          method: "POST",
          body: JSON.stringify({
            order_id: paid.razorpay_order_id,
            razorpay_payment_id: paid.razorpay_payment_id,
            signature: paid.razorpay_signature,
          }),
        });
        setNotice("Razorpay marked this invoice paid.");
        load();
      } else {
        setLink(result);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Razorpay did not start");
    } finally {
      setBusy(false);
    }
  }

  if (loading && invoices.length === 0) return <Loading label="Loading payments" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-slate-600">Collect against an open invoice. UPI and cash are on every plan. Online payments start on Growth.</p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm">{notice}</p> : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <Field label="Invoice">
          <select className={inputClass} value={invoiceId} onChange={(event) => { setInvoiceId(event.target.value); setQr(null); setLink(null); }}>
            {invoices.length === 0 ? <option value="">No invoices yet</option> : null}
            {invoices.map((row) => (
              <option key={row.id} value={row.id}>
                {row.number} · {row.customer?.name ?? "Customer"} · {row.status} · {inr(row.total)}
              </option>
            ))}
          </select>
        </Field>
        {invoice ? (
          <p className="mt-3 text-sm text-slate-600">
            Balance due <strong className="text-navy">{inr(due)}</strong>
            {tenant?.upi_vpa ? ` · UPI ${tenant.upi_vpa}` : ""}
          </p>
        ) : null}
        <div className="mt-4">
          <PayMethodTabs
            method={method === "card" ? "cash" : method}
            onlineLocked={onlineLocked}
            onLocked={() => showUpgrade("online_payments")}
            onChange={(next) => {
              setMethod(next);
              setQr(null);
              setLink(null);
            }}
          />
        </div>
        {method === "upi" ? (
          <LockedFeature feature="upi_qr" label="UPI QR">
            <div className="mt-4 space-y-3">
              {!upiReady ? (
                <p className="text-sm">
                  <Link className="font-semibold underline" href="/settings/payments">Add a UPI ID</Link> before a QR can be shown.
                </p>
              ) : null}
              <Field label="Amount">
                <input className={inputClass} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </Field>
              <Button type="button" disabled={busy || !invoice || !upiReady} onClick={() => void collectUpi()}>
                Show UPI QR
              </Button>
              {qr ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="w-44" dangerouslySetInnerHTML={{ __html: qr.qr_svg }} />
                  <div className="space-y-3 text-sm">
                    <p>Ask the customer to pay {inr(qr.amount)}. Reference {qr.tr}.</p>
                    <p className="break-all text-xs text-slate-500">{qr.upi_uri || (tenant ? buildUpiUri({ pa: tenant.upi_vpa ?? "", pn: tenant.upi_payee_name ?? tenant.name, am: qr.amount, tr: qr.tr }) : "")}</p>
                    <Field label="UTR (optional, 12 digits)">
                      <input className={inputClass} inputMode="numeric" maxLength={12} value={utr} onChange={(event) => setUtr(event.target.value.replace(/\D/g, ""))} />
                    </Field>
                    <div className="flex gap-2">
                      <Button type="button" disabled={busy} onClick={() => void confirmUpi()}>Payment received</Button>
                      <Button type="button" variant="ghost" disabled={busy} onClick={() => void authed(`/payments/${qr.payment_id}/void`, { method: "POST" }).then(() => setQr(null))}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </LockedFeature>
        ) : null}
        {method === "cash" ? (
          <LockedFeature feature="cash_payments" label="Cash">
            <div className="mt-4">
              <CashPanel due={Number(amount) || due} allowPartial busy={busy} onConfirm={(value) => void recordCash(value)} />
            </div>
          </LockedFeature>
        ) : null}
        {method === "online" ? (
          <LockedFeature feature="online_payments" label="Online payments">
            <div className="mt-4">
              <OnlineActions busy={busy} connected={connected} onCheckout={() => void startOnline("checkout")} onLink={() => void startOnline("link")} />
              {link ? (
                <PaymentLinkPanel
                  start={link}
                  onPaid={() => { setLink(null); setNotice("The payment link was paid."); load(); }}
                  onFailed={(message) => setError(message)}
                  onCancel={() => void authed(`/payments/${link.payment_id}/void`, { method: "POST" }).then(() => setLink(null))}
                />
              ) : null}
            </div>
          </LockedFeature>
        ) : null}
      </div>
      <div>
        <h2 className="font-semibold">Recent payments</h2>
        {payments.length === 0 ? <div className="mt-3"><Empty title="No payments yet" body="A UPI confirmation, cash receipt, or Razorpay capture will show up here." /></div> : null}
        {payments.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <Link className="font-semibold underline" href={`/invoices/${payment.invoice_id}`}>Invoice</Link>
                  <p className="capitalize text-slate-500">{payment.method.replaceAll("_", " ")} · {payment.status}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{inr(payment.amount)}</p>
                  <p className="text-xs text-slate-500">{payment.paid_at ? new Date(payment.paid_at).toLocaleString("en-IN") : payment.transaction_ref}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <Button type="button" variant="outline" disabled={payments.length < 20} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
