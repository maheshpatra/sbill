"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { CashPaymentError, NOTE_AMOUNTS, settleCash, type PayMethod } from "@/lib/cash";
import { inr, num } from "@/lib/money";
import { Button, inputClass } from "./ui";

export function PayMethodTabs({
  method,
  onlineLocked,
  onChange,
  onLocked,
}: {
  method: PayMethod;
  onlineLocked?: boolean;
  onChange: (method: PayMethod) => void;
  onLocked?: () => void;
}) {
  const tabs = [
    ["upi", "UPI QR"],
    ["cash", "Cash"],
    ["online", "Online"],
  ] as const;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Payment method">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={method === value}
            className={`flex items-center justify-center gap-1 rounded-full px-2 py-2 text-sm font-semibold ${method === value ? "bg-navy text-white" : "border border-slate-300 bg-white"}`}
            onClick={() => {
              if (value === "online" && onlineLocked) {
                onLocked?.();
                return;
              }
              onChange(value);
            }}
          >
            {value === "online" && onlineLocked ? <Lock size={14} aria-hidden /> : null}
            {label}
          </button>
        ))}
      </div>
      <button type="button" className={`text-sm underline ${method === "card" ? "font-semibold" : "text-slate-500"}`} onClick={() => onChange("card")}>
        Card, marked manual
      </button>
    </div>
  );
}

export function CashPanel({
  due,
  allowPartial,
  busy,
  onConfirm,
}: {
  due: number;
  allowPartial: boolean;
  busy?: boolean;
  onConfirm: (value: { tendered: number; changeGiven: number; applied: number }) => void;
}) {
  const [tendered, setTendered] = useState("");
  const [change, setChange] = useState("");
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (override) return;
    const received = num(tendered);
    setChange(tendered === "" ? "" : Math.max(0, Math.round((received - due) * 100) / 100).toString());
  }, [tendered, due, override]);

  function choose(amount: number) {
    setOverride(false);
    setTendered(String(amount));
    setError(null);
  }

  function confirm() {
    try {
      const settlement = settleCash({
        due,
        tendered: num(tendered),
        changeGiven: override ? num(change) : null,
        allowPartial,
      });
      setError(null);
      onConfirm(settlement);
    } catch (reason) {
      setError(reason instanceof CashPaymentError ? reason.message : "Check the cash amount");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">Amount due <strong>{inr(due)}</strong></p>
      <label className="block text-sm">Amount received
        <input className={`${inputClass} mt-1`} inputMode="decimal" value={tendered} onChange={(event) => { setOverride(false); setTendered(event.target.value); }} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={() => choose(due)}>Exact</button>
        {NOTE_AMOUNTS.map((note) => (
          <button key={note} type="button" className="rounded-full border px-3 py-1 text-sm" onClick={() => choose(note)}>{inr(note)}</button>
        ))}
      </div>
      <label className="block text-sm">Change to return
        <input
          className={`${inputClass} mt-1`}
          inputMode="decimal"
          value={change}
          onChange={(event) => {
            setOverride(true);
            setChange(event.target.value);
          }}
        />
      </label>
      <p className="text-sm text-slate-600">{allowPartial ? "A part payment is allowed. The rest stays on the invoice." : "The counter takes the full amount. You can hand back less change if the customer leaves it."}</p>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <Button type="button" disabled={busy || due <= 0} onClick={confirm}>Record cash</Button>
    </div>
  );
}
