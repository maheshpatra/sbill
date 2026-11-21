"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { priceInvoice } from "@billflow/gst";
import { authed } from "@/lib/api";
import { inr } from "@/lib/money";
import type { Customer, Page } from "@/lib/types";
import { Button, ErrorNote, Field, inputClass } from "./ui";

interface Line {
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  hsn_sac: string;
}

const blank: Line = { description: "", quantity: "1", unit_price: "", tax_rate: "18", hsn_sac: "" };

export function InvoiceForm() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [supply, setSupply] = useState<"intra" | "inter">("intra");
  const [place, setPlace] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    authed<Page<Customer>>("/customers?limit=100")
      .then((page) => {
        setCustomers(page.data);
        if (page.data[0]) setCustomerId(page.data[0].id);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const preview = useMemo(() => {
    try {
      return priceInvoice(
        lines
          .filter((line) => line.description && Number(line.unit_price) >= 0 && Number(line.quantity) > 0)
          .map((line) => ({
            quantity: line.quantity,
            unitPrice: line.unit_price || 0,
            gstRate: line.tax_rate || 0,
          })),
        supply,
      );
    } catch {
      return null;
    }
  }, [lines, supply]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await authed<{ id: string }>("/invoices", {
        method: "POST",
        body: JSON.stringify({
          customer_id: customerId,
          supply_type: supply,
          place_of_supply: place || undefined,
          due_at: due ? new Date(due).toISOString() : undefined,
          notes: notes || undefined,
          items: lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unit_price: Number(line.unit_price),
            tax_rate: Number(line.tax_rate || 0),
            hsn_sac: line.hsn_sac || undefined,
          })),
        }),
      });
      router.push(`/invoices/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the invoice");
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer">
          <select className={inputClass} required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            {customers.length === 0 ? <option value="">Add a customer first</option> : null}
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Supply">
          <select className={inputClass} value={supply} onChange={(event) => setSupply(event.target.value as "intra" | "inter")}>
            <option value="intra">Inside the state (CGST + SGST)</option>
            <option value="inter">Another state (IGST)</option>
          </select>
        </Field>
        <Field label="Place of supply" hint="State code, for example 27.">
          <input className={inputClass} value={place} onChange={(event) => setPlace(event.target.value)} />
        </Field>
        <Field label="Due date">
          <input className={inputClass} type="date" value={due} onChange={(event) => setDue(event.target.value)} />
        </Field>
      </div>
      <div className="space-y-3">
        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-5">
            <input className={inputClass} required placeholder="Description" value={line.description} onChange={(event) => update(index, { description: event.target.value })} />
            <input className={inputClass} required inputMode="decimal" placeholder="Qty" value={line.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
            <input className={inputClass} required inputMode="decimal" placeholder="Rate" value={line.unit_price} onChange={(event) => update(index, { unit_price: event.target.value })} />
            <input className={inputClass} inputMode="decimal" placeholder="GST %" value={line.tax_rate} onChange={(event) => update(index, { tax_rate: event.target.value })} />
            <input className={inputClass} placeholder="HSN/SAC" value={line.hsn_sac} onChange={(event) => update(index, { hsn_sac: event.target.value })} />
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, { ...blank }])}>
          Add line
        </Button>
      </div>
      <Field label="Notes">
        <textarea className={inputClass} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      {preview ? (
        <p className="text-sm text-slate-700">
          Taxable {inr(preview.taxableValue)} · Tax {inr(preview.tax)} · Total <strong>{inr(preview.total)}</strong>
          {supply === "inter" ? ` · IGST ${inr(preview.igst)}` : ` · CGST ${inr(preview.cgst)} · SGST ${inr(preview.sgst)}`}
        </p>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      <Button type="submit" disabled={pending || customers.length === 0}>
        {pending ? "Saving…" : "Save draft"}
      </Button>
    </form>
  );

  function update(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }
}
