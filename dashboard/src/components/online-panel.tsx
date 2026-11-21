"use client";

import Link from "next/link";
import { useEffect } from "react";
import { authed } from "@/lib/api";
import { Button } from "./ui";

export interface RazorpayCheckoutStart {
  mode: "checkout";
  payment_id: string;
  key_id: string;
  order_id: string;
  amount_paise: number;
}

export interface RazorpayLinkStart {
  mode: "link";
  payment_id: string;
  url: string;
  qr_svg: string;
  wa_link: string | null;
  sms_body: string;
}

export type RazorpayStart = RazorpayCheckoutStart | RazorpayLinkStart;

export function openTenantCheckout(start: RazorpayCheckoutStart) {
  return new Promise<{ razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    const open = () => {
      const Razorpay = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;
      if (!Razorpay) {
        reject(new Error("Razorpay Checkout did not load"));
        return;
      }
      const checkout = new Razorpay({
        key: start.key_id,
        order_id: start.order_id,
        amount: start.amount_paise,
        currency: "INR",
        name: "Payment",
        handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => resolve(response),
        modal: { ondismiss: () => reject(new Error("Checkout closed")) },
      });
      checkout.open();
    };
    if (existing) {
      open();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = open;
    script.onerror = () => reject(new Error("Could not load Razorpay"));
    document.body.appendChild(script);
  });
}

export function OnlineActions({
  connected,
  busy,
  onCheckout,
  onLink,
}: {
  connected: boolean | null;
  busy?: boolean;
  onCheckout: () => void;
  onLink: () => void;
}) {
  if (connected === false) {
    return (
      <p className="mt-3 text-sm">
        <Link className="font-semibold underline" href="/settings/payments">Connect Razorpay</Link> to collect online. Test-mode keys are enough to try it.
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" disabled={busy || connected === null} onClick={onCheckout}>Take payment here</Button>
      <Button type="button" variant="outline" disabled={busy || connected === null} onClick={onLink}>Send a link</Button>
    </div>
  );
}

export function PaymentLinkPanel({
  start,
  onPaid,
  onFailed,
  onCancel,
}: {
  start: RazorpayLinkStart;
  onPaid: () => void;
  onFailed: (message: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const timer = window.setInterval(() => {
      void authed<{ status: string }>(`/payments/${start.payment_id}`)
        .then((row) => {
          if (row.status === "succeeded") onPaid();
          if (row.status === "failed") onFailed("The customer’s payment did not go through.");
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [start.payment_id, onPaid, onFailed]);

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm">Waiting for Razorpay. This updates when the payment is captured.</p>
      <div className="w-52" dangerouslySetInnerHTML={{ __html: start.qr_svg }} />
      <p className="break-all text-xs text-slate-500">{start.url}</p>
      <div className="flex flex-wrap gap-2">
        {start.wa_link ? <a className="rounded-full bg-navy px-3 py-2 text-sm font-semibold text-white" href={start.wa_link} target="_blank" rel="noreferrer">WhatsApp</a> : null}
        <a className="rounded-full border px-3 py-2 text-sm font-semibold" href={`sms:?&body=${encodeURIComponent(start.sms_body)}`}>SMS</a>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
