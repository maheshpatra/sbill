"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { priceInvoice } from "@billflow/gst";
import { authed } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rememberedPayMethod, rememberPayMethod, type PayMethod } from "@/lib/cash";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { OnlineActions, PaymentLinkPanel, openTenantCheckout, type RazorpayLinkStart, type RazorpayStart } from "@/components/online-panel";
import { inr, num } from "@/lib/money";
import { CashPanel, PayMethodTabs } from "@/components/cash-panel";
import { FeatureBanner } from "@/components/feature-gate";
import { Button, inputClass } from "@/components/ui";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn_sac: string | null;
  unit: string;
  price: number | string;
  gst_rate: number | string;
}

interface CartLine {
  key: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  gst_rate: number;
  hsn_sac?: string;
  unit?: string;
  discount: number;
}

const STORAGE = "billflow-pos-cart";

export default function PosPage() {
  const { ready, session } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const { entitlements, showUpgrade } = useEntitlements();
  const [method, setMethod] = useState<PayMethod>("cash");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [link, setLink] = useState<(RazorpayLinkStart & { number: string; total: number }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ number: string; total: number; upi_uri?: string | null; tendered?: number | null; change?: number | null } | null>(null);
  const [upi, setUpi] = useState<{ payment_id: string; number: string; total: number; upi_uri: string; qr_svg: string } | null>(null);
  const [utr, setUtr] = useState("");

  useEffect(() => {
    const savedMethod = rememberedPayMethod();
    if (savedMethod) setMethod(savedMethod);
    const saved = localStorage.getItem(STORAGE);
    if (saved) setCart(JSON.parse(saved) as CartLine[]);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!session) return;
    void authed<{ data: Product[] }>("/products").then((page) => setProducts(page.data)).catch((reason: Error) => setMessage(reason.message));
    void authed<{ connected: boolean }>("/settings/razorpay").then((row) => setConnected(row.connected)).catch(() => setConnected(false));
  }, [session]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        document.getElementById("pos-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const preview = useMemo(() => {
    if (!cart.length) return null;
    return priceInvoice(
      cart.map((line) => ({ quantity: line.quantity, unitPrice: line.unit_price, gstRate: line.gst_rate })),
      "intra",
    );
  }, [cart]);

  const matches = products.filter((product) => {
    const hay = `${product.name} ${product.sku ?? ""} ${product.barcode ?? ""}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  });

  function add(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.product_id === product.id);
      if (existing) return current.map((line) => (line.product_id === product.id ? { ...line, quantity: line.quantity + 1 } : line));
      return [...current, {
        key: product.id,
        product_id: product.id,
        description: product.name,
        quantity: 1,
        unit_price: num(product.price),
        gst_rate: num(product.gst_rate),
        hsn_sac: product.hsn_sac ?? undefined,
        unit: product.unit,
        discount: 0,
      }];
    });
    setQuery("");
  }

  async function checkout(cash?: { tendered: number; changeGiven: number }, onlineMode?: "checkout" | "link") {
    if (!preview) return;
    setMessage(null);
    try {
      const result = await authed<{ number: string; total: number; payment_id?: string; payment_status?: string; upi_uri?: string | null; qr_svg?: string | null; amount_tendered?: number | null; change_given?: number | null; razorpay?: RazorpayStart }>("/pos/checkout", {
        method: "POST",
        body: JSON.stringify({
          walk_in_name: "Walk-in",
          method: method === "online" ? "razorpay" : method,
          online_mode: onlineMode,
          tendered: cash?.tendered,
          change_given: cash?.changeGiven,
          lines: cart.map((line) => ({
            product_id: line.product_id,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unit_price,
            gst_rate: line.gst_rate,
            hsn_sac: line.hsn_sac,
            unit: line.unit,
            discount: line.discount,
          })),
        }),
      });
      setCart([]);
      rememberPayMethod(method);
      if (result.razorpay?.mode === "checkout" && result.payment_id) {
        const paid = await openTenantCheckout(result.razorpay);
        await authed(`/payments/${result.payment_id}/razorpay/verify`, {
          method: "POST",
          body: JSON.stringify({ order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, signature: paid.razorpay_signature }),
        });
        setReceipt({ number: result.number, total: num(result.total) });
        return;
      }
      if (result.razorpay?.mode === "link") {
        setLink({ ...result.razorpay, number: result.number, total: num(result.total) });
        return;
      }
      if (method === "upi" && result.qr_svg && result.payment_id && result.upi_uri) {
        setUpi({ payment_id: result.payment_id, number: result.number, total: num(result.total), upi_uri: result.upi_uri, qr_svg: result.qr_svg });
      } else {
        setReceipt({
          number: result.number,
          total: num(result.total),
          upi_uri: result.upi_uri,
          tendered: result.amount_tendered,
          change: result.change_given,
        });
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Checkout failed");
    }
  }

  async function confirmPos() {
    if (!upi) return;
    try {
      await authed(`/payments/${upi.payment_id}/confirm`, {
        method: "POST",
        body: JSON.stringify(utr ? { utr } : {}),
      });
      setReceipt({ number: upi.number, total: upi.total, upi_uri: upi.upi_uri });
      setUpi(null);
      setUtr("");
      window.setTimeout(() => window.print(), 50);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Payment was not confirmed");
    }
  }

  async function cancelPos() {
    if (!upi) return;
    try {
      await authed(`/payments/${upi.payment_id}/void`, { method: "POST" });
      setUpi(null);
      setUtr("");
      setMessage("UPI payment cancelled. The invoice stays unpaid.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not cancel the QR");
    }
  }

  if (!ready) return <p className="p-6">Loading…</p>;
  if (!session) return <p className="p-6">Sign in to use the counter. <Link href="/login" className="underline">Sign in</Link></p>;

  return (
    <main className="min-h-screen bg-[#f4f6f5] p-4 text-navy">
      <FeatureBanner feature="pos" label="The counter" />
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Counter</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/pos/settings" className="underline">Receipt settings</Link>
          <Link href="/" className="underline">Back to books</Link>
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <input
            id="pos-search"
            className={`${inputClass} h-14 text-lg`}
            placeholder="Search or scan a barcode, then Enter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches[0]) add(matches[0]);
            }}
          />
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {matches.slice(0, 12).map((product) => (
              <li key={product.id}>
                <button type="button" className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left" onClick={() => add(product)}>
                  <span className="font-semibold">{product.name}</span>
                  <span className="mt-1 block text-sm text-slate-500">{inr(product.price)} · GST {num(product.gst_rate)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <aside className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Cart</h2>
          {cart.length === 0 ? <p className="mt-3 text-sm text-slate-500">Empty. Press / to search.</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {cart.map((line) => (
                <li key={line.key} className="flex items-center justify-between gap-2">
                  <span>{line.description}</span>
                  <input className="w-16 rounded-lg border px-2 py-1" type="number" min={1} value={line.quantity} onChange={(event) => setCart((current) => current.map((item) => item.key === line.key ? { ...item, quantity: Number(event.target.value) } : item))} />
                  <span>{inr(line.unit_price * line.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          {preview ? <p className="mt-4 text-lg font-bold">Total {inr(preview.total)} · tax {inr(preview.tax)}</p> : null}
          <div className="mt-3">
            <PayMethodTabs
              method={method}
              onlineLocked={Boolean(entitlements) && !featureOn(entitlements, "online_payments")}
              onLocked={() => showUpgrade("online_payments")}
              onChange={(next) => {
                if (upi) void cancelPos();
                if (link) void authed(`/payments/${link.payment_id}/void`, { method: "POST" }).then(() => setLink(null));
                setMethod(next);
                rememberPayMethod(next);
              }}
            />
          </div>
          {method === "online" && preview ? (
            <>
              <OnlineActions connected={connected} onCheckout={() => void checkout(undefined, "checkout")} onLink={() => void checkout(undefined, "link")} />
              {link ? (
                <PaymentLinkPanel
                  start={link}
                  onPaid={() => {
                    setReceipt({ number: link.number, total: link.total });
                    setLink(null);
                  }}
                  onFailed={(text) => {
                    setMessage(text);
                    setLink(null);
                  }}
                  onCancel={() => void authed(`/payments/${link.payment_id}/void`, { method: "POST" }).then(() => setLink(null))}
                />
              ) : null}
            </>
          ) : method === "cash" && preview ? (
            <div className="mt-3">
              <CashPanel due={num(preview.total)} allowPartial={false} onConfirm={(cash) => void checkout(cash)} />
            </div>
          ) : (
            <Button type="button" className="mt-4 w-full" disabled={!cart.length} onClick={() => void checkout()}>
              {method === "upi" ? "Show UPI QR" : "Mark card paid"}
            </Button>
          )}
          {message ? <p className="mt-3 text-sm text-rose-700">{message}</p> : null}
          {receipt ? (
            <div className="receipt mt-4 border-t pt-3 text-sm" style={{ maxWidth: 320 }}>
              <p className="font-bold">{receipt.number}</p>
              <p>Total {inr(receipt.total)}</p>
              {receipt.tendered != null ? <p>Tendered {inr(receipt.tendered)}</p> : null}
              {receipt.change != null ? <p>Change {inr(receipt.change)}</p> : null}
              {receipt.upi_uri ? <p className="break-all">UPI {receipt.upi_uri}</p> : null}
              <button type="button" className="mt-2 underline" onClick={() => window.print()}>Print receipt</button>
            </div>
          ) : null}
        </aside>
      </div>
      {upi ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy p-6 text-white">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-navy">
            <p className="text-sm text-slate-500">Show this to the customer</p>
            <h2 className="text-2xl font-bold">{inr(upi.total)}</h2>
            <div className="mx-auto mt-4 w-64" dangerouslySetInnerHTML={{ __html: upi.qr_svg }} />
            <p className="mt-2 break-all text-xs text-slate-500">{upi.upi_uri}</p>
            <label className="mt-4 block text-sm">UTR, 12 digits, optional
              <input className={`${inputClass} mt-1`} inputMode="numeric" maxLength={12} value={utr} onChange={(event) => setUtr(event.target.value.replace(/\D/g, ""))} />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={() => void confirmPos()}>Payment received</Button>
              <Button type="button" variant="ghost" onClick={() => void cancelPos()}>Cancel / not received</Button>
            </div>
          </div>
        </div>
      ) : null}
      <style>{`@media print { body * { visibility: hidden } .receipt, .receipt * { visibility: visible } .receipt { position: absolute; left: 0; top: 0; width: 80mm } }`}</style>
    </main>
  );
}
