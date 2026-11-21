"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CashPanel, PayMethodTabs } from "@/components/cash-panel";
import { SavedCheck } from "@/components/saved-check";
import { InvoiceEvents } from "@/components/invoice-events";
import { OnlineActions, PaymentLinkPanel, openTenantCheckout, type RazorpayLinkStart, type RazorpayStart } from "@/components/online-panel";
import { Button, CardSkeleton, ErrorNote, StatusBadge, inputClass } from "@/components/ui";
import { authed, authedBlob } from "@/lib/api";
import { rememberedPayMethod, rememberPayMethod, type PayMethod } from "@/lib/cash";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { canWrite } from "@/lib/access";
import { inr, num } from "@/lib/money";
import type { Invoice, Me, Payment, Tenant } from "@/lib/types";

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [role, setRole] = useState<Me["user"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const { entitlements, showUpgrade } = useEntitlements();
  const [method, setMethod] = useState<PayMethod>("cash");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [link, setLink] = useState<RazorpayLinkStart | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ payment_id: string; upi_uri: string; qr_svg: string; amount: number | string; tr: string } | null>(null);
  const [utr, setUtr] = useState("");

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([
      authed<Invoice>(`/invoices/${params.id}`),
      authed<{ data: Payment[] }>(`/payments?invoice_id=${params.id}&limit=50`),
      authed<Tenant>("/tenants/current"),
      authed<Me>("/auth/me"),
    ])
      .then(([nextInvoice, paymentPage, nextTenant, me]) => {
        setInvoice(nextInvoice);
        setPayments(paymentPage.data);
        setTenant(nextTenant);
        setRole(me.user);
        setAmount(String(num(nextInvoice.total)));
        const saved = rememberedPayMethod();
        if (saved) setMethod(saved);
        else if (paymentPage.data[0]?.method === "cash") setMethod("cash");
        else if (paymentPage.data[0]?.method === "upi" || paymentPage.data[0]?.method === "upi_qr") setMethod("upi");
        else if (paymentPage.data[0]?.method === "card") setMethod("card");
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    void authed<{ connected: boolean }>("/settings/razorpay").then((row) => setConnected(row.connected)).catch(() => setConnected(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("saved") === "1") setSaved(true);
  }, []);

  async function markPaid(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authed(`/invoices/${params.id}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(amount),
          method,
          transaction_ref: reference || undefined,
        }),
      });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment was not recorded");
    } finally {
      setBusy(false);
    }
  }

  async function transition(path: "send" | "void") {
    setBusy(true);
    setError(null);
    try {
      await authed(`/invoices/${params.id}/${path}`, { method: "POST" });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the invoice");
      setBusy(false);
    }
  }

  if (loading) return <CardSkeleton />;
  if (!invoice) return <ErrorNote message={error ?? "Invoice not found"} onRetry={load} />;

  const current = invoice;
  const writable = canWrite(role?.role);
  const open = invoice.status === "draft" || invoice.status === "sent" || invoice.status === "overdue" || invoice.status === "partially_paid";
  const received = payments.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + num(payment.amount), 0);
  const balance = Math.max(0, num(invoice.total) - received);

  async function collectUpi() {
    setBusy(true);
    setError(null);
    try {
      const result = await authed<{ payment_id: string; upi_uri: string; qr_svg: string; amount: number | string; tr: string }>(`/invoices/${current.id}/upi`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount) || balance }),
      });
      setQr(result);
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
      await authed(`/payments/${qr.payment_id}/confirm`, {
        method: "POST",
        body: JSON.stringify(utr ? { utr } : {}),
      });
      setQr(null);
      setUtr("");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment was not confirmed");
      setBusy(false);
    }
  }

  async function startOnline(mode: "checkout" | "link") {
    setBusy(true);
    setError(null);
    try {
      const result = await authed<RazorpayStart>(`/invoices/${current.id}/razorpay`, {
        method: "POST",
        body: JSON.stringify({ mode, amount: Number(amount) || balance }),
      });
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

  async function cancelUpi() {
    if (!qr) return;
    setBusy(true);
    try {
      await authed(`/payments/${qr.payment_id}/void`, { method: "POST" });
      setQr(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel the QR");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {saved ? <SavedCheck label="Bill saved" onDone={() => setSaved(false)} /> : null}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Invoice</p>
          <h1 className="text-2xl font-bold">{invoice.number}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={invoice.status} />
          {writable ? <Link className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold" href={`/invoices/${invoice.id}/edit`}>Edit</Link> : null}
          <Button type="button" variant="outline" onClick={() => window.print()}>Print</Button>
          <Link className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold" href={`/print/invoice/${invoice.id}`}>Template PDF</Link>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void authedBlob(`/invoices/${invoice.id}/pdf`)
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `${invoice.number}.pdf`;
                  link.click();
                  URL.revokeObjectURL(url);
                })
                .catch((reason: Error) => setError(reason.message))
            }
          >
            PDF
          </Button>
          {writable ? (
            <Button
              type="button"
              variant="navy"
              onClick={() =>
                void authed<{ wa_link: string | null; status: string; url: string }>(`/invoices/${invoice.id}/whatsapp`, { method: "POST" })
                  .then((result) => {
                    if (result.wa_link && result.status !== "sent") window.open(result.wa_link, "_blank", "noopener");
                    else setError(result.status === "sent" ? null : "WhatsApp message queued");
                  })
                  .catch((reason: Error) => setError(reason.message))
              }
            >
              Share on WhatsApp
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <div className="no-print"><ErrorNote message={error} /></div> : null}
      <InvoiceEvents invoiceId={invoice.id} />
      <article className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-bold">{tenant?.legal_name || tenant?.name}</p>
            <p className="text-sm text-slate-600">{tenant?.gstin ? `GSTIN ${tenant.gstin}` : "GSTIN not set"}</p>
            <p className="text-sm text-slate-600">{[tenant?.city, tenant?.state].filter(Boolean).join(", ")}</p>
          </div>
          <img src="/brand/billflow-icon.svg" alt="" width={40} height={40} />
        </div>
        <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <p><span className="text-slate-500">Bill to</span><br /><strong>{invoice.customer?.name}</strong><br />{invoice.customer?.gstin}</p>
          <p className="sm:text-right">
            <span className="text-slate-500">Due</span><br />
            {invoice.due_at ? new Date(invoice.due_at).toLocaleDateString("en-IN") : "—"}
            <br />
            {invoice.supply_type === "inter" ? "Inter-state · IGST" : "Intra-state · CGST + SGST"}
          </p>
        </div>
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 font-medium">HSN</th>
              <th className="py-2 font-medium">Qty</th>
              <th className="py-2 font-medium">Tax</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items ?? []).map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2">{item.description}</td>
                <td className="py-2">{item.hsn_sac ?? "—"}</td>
                <td className="py-2">{num(item.quantity)}</td>
                <td className="py-2">{inr(item.tax_amount)}</td>
                <td className="py-2 text-right">{inr(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Taxable</dt><dd>{inr(invoice.amount)}</dd></div>
          <div className="flex justify-between"><dt>CGST</dt><dd>{inr((invoice.items ?? []).reduce((sum, item) => sum + num(item.cgst_amount), 0))}</dd></div>
          <div className="flex justify-between"><dt>SGST</dt><dd>{inr((invoice.items ?? []).reduce((sum, item) => sum + num(item.sgst_amount), 0))}</dd></div>
          <div className="flex justify-between"><dt>IGST</dt><dd>{inr((invoice.items ?? []).reduce((sum, item) => sum + num(item.igst_amount), 0))}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{inr(invoice.tax)}</dd></div>
          <div className="flex justify-between"><dt>Discount</dt><dd>{inr(invoice.discount)}</dd></div>
          <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{inr(invoice.total)}</dd></div>
        </dl>
        {invoice.notes ? <p className="mt-6 text-sm text-slate-600">{invoice.notes}</p> : null}
        {qr ? (
          <div className="mt-6 flex items-center gap-4">
            <div className="w-36" dangerouslySetInnerHTML={{ __html: qr.qr_svg }} />
            <p className="text-sm">Pay {inr(qr.amount)}<br />Ref {qr.tr}</p>
          </div>
        ) : null}
      </article>
      <section className="no-print space-y-3">
        <h2 className="font-semibold">Payments</h2>
        {payments.length === 0 ? <p className="text-sm text-slate-600">No payments recorded.</p> : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm">
            {payments.map((payment) => (
              <li key={payment.id} className="flex justify-between px-4 py-3">
                <span className="capitalize">{payment.method.replace("_", " ")} · {payment.status}</span>
                <span className="font-semibold">{inr(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {writable && open && balance > 0 ? (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">Record payment</h2>
            <PayMethodTabs
              method={method}
              onlineLocked={Boolean(entitlements) && !featureOn(entitlements, "online_payments")}
              onLocked={() => showUpgrade("online_payments")}
              onChange={(next) => {
                if (qr) void cancelUpi();
                if (link) void authed(`/payments/${link.payment_id}/void`, { method: "POST" }).then(() => setLink(null));
                setMethod(next);
                rememberPayMethod(next);
              }}
            />
            {method === "upi" ? (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="text-sm">QR amount
                    <input className={`${inputClass} mt-1`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
                  </label>
                  <Button type="button" variant="navy" disabled={busy} onClick={() => void collectUpi()}>Collect via UPI</Button>
                </div>
                {qr ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr]">
                    <div className="w-52" dangerouslySetInnerHTML={{ __html: qr.qr_svg }} />
                    <div className="space-y-3">
                      <p className="break-all text-xs text-slate-500">{qr.upi_uri}</p>
                      <label className="block text-sm">UTR, 12 digits, optional
                        <input className={`${inputClass} mt-1`} inputMode="numeric" maxLength={12} value={utr} onChange={(event) => setUtr(event.target.value.replace(/\D/g, ""))} />
                      </label>
                      <div className="flex gap-2">
                        <Button type="button" disabled={busy} onClick={() => void confirmUpi()}>Payment received</Button>
                        <Button type="button" variant="ghost" disabled={busy} onClick={() => void cancelUpi()}>Cancel / not received</Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {method === "cash" ? (
              <CashPanel
                due={balance}
                allowPartial
                busy={busy}
                onConfirm={(cash) => {
                  setBusy(true);
                  setError(null);
                  void authed(`/invoices/${current.id}/mark-paid`, {
                    method: "POST",
                    body: JSON.stringify({
                      amount: cash.applied,
                      method: "cash",
                      amount_tendered: cash.tendered,
                      change_given: cash.changeGiven,
                    }),
                  })
                    .then(() => {
                      rememberPayMethod("cash");
                      load();
                    })
                    .catch((reason: Error) => setError(reason.message))
                    .finally(() => setBusy(false));
                }}
              />
            ) : null}
            {method === "online" ? (
              <div>
                <OnlineActions
                  connected={connected}
                  busy={busy}
                  onCheckout={() => void startOnline("checkout")}
                  onLink={() => void startOnline("link")}
                />
                {link ? (
                  <PaymentLinkPanel
                    start={link}
                    onPaid={() => {
                      setLink(null);
                      load();
                    }}
                    onFailed={(text) => {
                      setError(text);
                      setLink(null);
                    }}
                    onCancel={() => void authed(`/payments/${link.payment_id}/void`, { method: "POST" }).then(() => setLink(null))}
                  />
                ) : null}
              </div>
            ) : null}
            {method === "card" ? (
              <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={markPaid}>
                <label className="text-sm">Amount
                  <input className={`${inputClass} mt-1`} required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </label>
                <label className="text-sm">Reference
                  <input className={`${inputClass} mt-1`} value={reference} onChange={(event) => setReference(event.target.value)} />
                </label>
                <Button type="submit" disabled={busy}>Mark card paid</Button>
              </form>
            ) : null}
          </div>
        ) : null}
        {writable && invoice.status === "draft" ? (
          <Button type="button" variant="navy" disabled={busy} onClick={() => void transition("send")}>Mark sent</Button>
        ) : null}
        {writable && invoice.status !== "void" && invoice.status !== "paid" ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void transition("void")}>Void invoice</Button>
        ) : null}
      </section>
    </div>
  );
}
