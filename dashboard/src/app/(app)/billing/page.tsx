"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardSkeleton, ErrorNote } from "@/components/ui";
import { authed } from "@/lib/api";
import { canAdmin } from "@/lib/access";
import { inr, num } from "@/lib/money";
import type { Entitlements, Me, Plan, PlatformInvoice } from "@/lib/types";

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [admin, setAdmin] = useState(false);
  const [yearly, setYearly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    setLoading(true);
    let entitlementError: string | null = null;
    Promise.all([
      authed<{ data: Plan[] }>("/billing/plans"),
      authed<Entitlements>("/entitlements").catch((reason: Error) => {
        entitlementError = reason.message;
        return null;
      }),
      authed<Me>("/auth/me"),
      authed<{ data: PlatformInvoice[] }>("/billing/invoices").catch(() => ({ data: [] as PlatformInvoice[] })),
    ])
      .then(([planPage, nextEntitlements, me, invoicePage]) => {
        setPlans(planPage.data);
        setEntitlements(nextEntitlements);
        setAdmin(canAdmin(me.user?.role));
        setInvoices(invoicePage.data);
        if (entitlementError) setError(entitlementError);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function choose(plan: Plan) {
    setPending(plan.code);
    setError(null);
    setNotice(null);
    const current = plans.find((row) => row.code === entitlements?.plan);
    const upgrading = (plan.sort_order ?? 0) > (current?.sort_order ?? 0);
    try {
      if (upgrading) {
        const result = await authed<{ status: string; message?: string; key_id?: string; order_id?: string; amount_paise?: number }>("/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan_code: plan.code, billing_cycle: yearly ? "yearly" : "monthly" }),
        });
        if (result.key_id && result.order_id) {
          await openRazorpay(result.key_id, result.order_id, result.amount_paise ?? 0);
          setNotice("Payment started. The plan turns on when Razorpay confirms it.");
        } else {
          setNotice(result.message || `Checkout ${result.status}.`);
        }
      } else {
        const result = await authed<{ message?: string }>("/billing/subscription", {
          method: "POST",
          body: JSON.stringify({ plan_code: plan.code, billing_cycle: yearly ? "yearly" : "monthly" }),
        });
        setNotice(result.message || "The change is scheduled for the end of this period.");
      }
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change plan");
    } finally {
      setPending(null);
    }
  }

  if (loading) return <CardSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
          <p className="text-sm text-slate-600">
            Current plan: {entitlements?.plan_name ?? "—"} {entitlements?.subscription_status ? `· ${entitlements.subscription_status}` : ""}
          </p>
        </div>
        <div className="inline-flex rounded-full border border-slate-300 bg-white p-1 text-sm">
          <button type="button" className={`rounded-full px-3 py-1 ${yearly ? "" : "bg-navy text-white"}`} onClick={() => setYearly(false)}>Monthly</button>
          <button type="button" className={`rounded-full px-3 py-1 ${yearly ? "bg-navy text-white" : ""}`} onClick={() => setYearly(true)}>Yearly</button>
        </div>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/10 px-4 py-3 text-sm text-navy">{notice}</p> : null}
      {entitlements?.over_limit_grace ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          This business is over the current plan limits. Existing records stay available. New invoices, products, customers, members, and domains wait until usage fits.
        </p>
      ) : null}
      {entitlements ? (
        <Card>
          <h2 className="font-semibold">Usage this month</h2>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <li>Invoices {entitlements.usage.invoices_this_month}{limit(entitlements.features.invoices_per_month)}</li>
            <li>Customers {entitlements.usage.customers}{limit(entitlements.features.customers)}</li>
            <li>Members {entitlements.usage.members}{limit(entitlements.features.members)}</li>
            <li>Products {entitlements.usage.products ?? 0}{limit(entitlements.features.max_products)}</li>
            <li>Domains {entitlements.usage.custom_domains ?? 0}{limit(entitlements.features.max_custom_domains)}</li>
          </ul>
        </Card>
      ) : null}
      <Card>
        <h2 className="font-semibold">What each plan includes</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-3">Feature</th>
                {plans.map((plan) => <th key={plan.id} className="py-2 pr-3">{plan.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {comparison.map(([key, label]) => (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-2 pr-3">{label}</td>
                  {plans.map((plan) => <td key={plan.id} className="py-2 pr-3">{plan.features?.[key] === true ? "Yes" : "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const price = yearly ? plan.price_yearly : plan.price_monthly;
          const current = entitlements?.plan === plan.code;
          return (
            <li key={plan.id} className={`rounded-2xl border p-5 ${current ? "border-navy bg-navy text-white" : "border-slate-200 bg-white"}`}>
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-2 text-3xl font-bold">{num(price) === 0 ? "Free" : inr(price)}</p>
              <p className={`mt-3 text-sm ${current ? "text-slate-200" : "text-slate-600"}`}>{plan.description}</p>
              {admin ? (
                <Button className="mt-6" variant={current ? "primary" : "navy"} loading={pending === plan.code} disabled={current} onClick={() => void choose(plan)}>
                  {current ? "Current plan" : pending === plan.code ? "Switching…" : "Choose"}
                </Button>
              ) : (
                <p className="mt-6 text-sm">Only an owner or admin can change the plan.</p>
              )}
            </li>
          );
        })}
      </ul>
      <Card>
        <h2 className="font-semibold">Platform invoices</h2>
        {invoices.length === 0 ? <p className="mt-2 text-sm text-slate-600">No billflow charges yet.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex justify-between gap-3">
                <span>{invoice.number}</span>
                <span>{inr(invoice.total_paise / 100)} · GST {inr((invoice.cgst_paise + invoice.sgst_paise + invoice.igst_paise) / 100)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const comparison: Array<[string, string]> = [
  ["upi_qr", "UPI QR on invoices"],
  ["gst_invoices", "GST invoices"],
  ["product_catalog", "Product catalog"],
  ["whatsapp_click_to_chat", "WhatsApp click-to-chat"],
  ["auto_reminders", "Automatic reminders"],
  ["pos", "POS counter"],
  ["online_payments", "Online payments"],
  ["custom_domains", "Custom domains"],
  ["whatsapp_sharing", "WhatsApp Cloud API"],
];

async function openRazorpay(key: string, orderId: string, amount: number) {
  await loadScript("https://checkout.razorpay.com/v1/checkout.js");
  const Razorpay = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;
  if (!Razorpay) return;
  const checkout = new Razorpay({ key, order_id: orderId, amount, currency: "INR", name: "billflow" });
  checkout.open();
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay"));
    document.body.appendChild(script);
  });
}

function limit(value: number | boolean | null | undefined) {
  if (value === null || value === undefined) return " / unlimited";
  if (typeof value === "boolean") return "";
  return ` / ${value}`;
}
