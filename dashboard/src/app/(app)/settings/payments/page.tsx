"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buildUpiUri, upiQrSvg, UPI_VPA } from "@billflow/upi";
import { Button, Card, ErrorNote, Field, Loading, inputClass } from "@/components/ui";
import { authed } from "@/lib/api";
import { canAdmin } from "@/lib/access";
import type { Me, Tenant } from "@/lib/types";

export default function PaymentSettingsPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [admin, setAdmin] = useState(false);
  const [vpa, setVpa] = useState("");
  const [payee, setPayee] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [razorpayConnected, setRazorpayConnected] = useState(false);

  useEffect(() => {
    Promise.all([authed<Tenant>("/tenants/current"), authed<Me>("/auth/me")])
      .then(([next, me]) => {
        setTenant(next);
        setVpa(next.upi_vpa ?? "");
        setPayee(next.upi_payee_name ?? next.legal_name ?? next.name);
        setAdmin(canAdmin(me.user?.role));
        return authed<{ key_id: string | null; connected: boolean }>("/settings/razorpay");
      })
      .then((razorpay) => {
        if (!razorpay) return;
        setKeyId(razorpay.key_id ?? "");
        setRazorpayConnected(razorpay.connected);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!UPI_VPA.test(vpa.trim()) || payee.trim().length < 2) {
      setPreview("");
      return;
    }
    let cancelled = false;
    upiQrSvg({ pa: vpa.trim(), pn: payee.trim(), am: "1.00", tn: "billflow test", tr: "TESTQR" })
      .then((svg) => {
        if (!cancelled) setPreview(svg);
      })
      .catch(() => {
        if (!cancelled) setPreview("");
      });
    return () => {
      cancelled = true;
    };
  }, [vpa, payee]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await authed<Tenant>("/tenants/current", {
        method: "PATCH",
        body: JSON.stringify({ upi_vpa: vpa.trim(), upi_payee_name: payee.trim() }),
      });
      setTenant(saved);
      setNotice("Payment settings saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the VPA");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  const uri = preview ? buildUpiUri({ pa: vpa.trim(), pn: payee.trim(), am: "1.00", tn: "billflow test", tr: "TESTQR" }) : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-slate-500 underline">Settings</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-slate-600">UPI QR on invoices is available on every plan. The counter still follows the POS plan.</p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm">{notice}</p> : null}
      <Card>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
          <Field label="UPI VPA">
            <input className={inputClass} disabled={!admin} value={vpa} placeholder="shop@okhdfcbank" onChange={(event) => setVpa(event.target.value)} />
          </Field>
          <Field label="Name in the UPI app">
            <input className={inputClass} disabled={!admin} value={payee} onChange={(event) => setPayee(event.target.value)} />
          </Field>
          {admin ? <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div> : <p className="text-sm text-slate-600 sm:col-span-2">Only an owner or admin can change payment settings.</p>}
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">Test QR</h2>
        <p className="mt-1 text-sm text-slate-600">A ₹1.00 preview. It does not create a payment.</p>
        {preview ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <div className="w-44" dangerouslySetInnerHTML={{ __html: preview }} />
            <p className="break-all text-xs text-slate-500">{uri}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Enter a VPA such as shop@okhdfcbank to preview the code.</p>
        )}
        {tenant?.upi_vpa ? <p className="mt-3 text-sm">Saved VPA {tenant.upi_vpa}</p> : null}
      </Card>
      <Card>
        <h2 className="font-semibold">Razorpay for your customers</h2>
        <p className="mt-1 text-sm text-slate-600">
          These keys collect money into your Razorpay account. They are separate from the keys billflow uses to bill you for a plan. Secrets are encrypted and are not shown again.
          Saving keys, testing the connection, and taking an online payment need a server secret. Without it, those actions are not available in this environment.
        </p>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void authed("/settings/razorpay", {
              method: "PUT",
              body: JSON.stringify({
                key_id: keyId.trim(),
                key_secret: keySecret || undefined,
                webhook_secret: webhookSecret || undefined,
              }),
            })
              .then(() => {
                setRazorpayConnected(true);
                setKeySecret("");
                setWebhookSecret("");
                setNotice("Razorpay keys saved.");
              })
              .catch((reason: Error) => setError(reason.message))
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Key id">
            <input className={inputClass} disabled={!admin} value={keyId} placeholder="rzp_test_..." onChange={(event) => setKeyId(event.target.value)} />
          </Field>
          <Field label="Key secret">
            <input className={inputClass} disabled={!admin} type="password" value={keySecret} placeholder={razorpayConnected ? "Saved. Enter a new secret to replace it." : "Key secret"} onChange={(event) => setKeySecret(event.target.value)} />
          </Field>
          <Field label="Webhook secret">
            <input className={inputClass} disabled={!admin} type="password" value={webhookSecret} placeholder={razorpayConnected ? "Saved. Enter a new secret to replace it." : "Webhook secret"} onChange={(event) => setWebhookSecret(event.target.value)} />
          </Field>
          {admin ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || keyId.trim().length < 8}>Save Razorpay</Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !razorpayConnected}
                onClick={() => {
                  setBusy(true);
                  void authed("/settings/razorpay/test", { method: "POST" })
                    .then(() => setNotice("Razorpay accepted the keys."))
                    .catch((reason: Error) => setError(reason.message))
                    .finally(() => setBusy(false));
                }}
              >
                Test connection
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Only an owner or admin can connect Razorpay.</p>
          )}
        </form>
      </Card>
    </div>
  );
}
