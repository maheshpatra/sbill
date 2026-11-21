"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isValidGstin } from "@billflow/gst";
import { authed } from "@/lib/api";
import { GST_STATES, stateName } from "@/lib/states";
import { Button, ErrorNote, Field, inputClass } from "./ui";

export function CustomerForm({
  id,
  initial,
}: {
  id?: string;
  initial?: { name: string; email: string; phone: string; company: string; gstin: string; notes: string; state_code?: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [gstin, setGstin] = useState(initial?.gstin ?? "");
  const [stateCode, setStateCode] = useState(initial?.state_code ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    if (gstin && !isValidGstin(gstin)) {
      setError("GSTIN failed the format or checksum check.");
      setPending(false);
      return;
    }
    const payload = {
      name,
      email: email || undefined,
      phone,
      company,
      gstin: gstin || undefined,
      notes,
      billing_address: stateCode ? { state_code: stateCode, state: stateName(stateCode), country: "IN" } : undefined,
    };
    try {
      if (id) {
        await authed(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
        router.push("/customers");
      } else {
        await authed("/customers", { method: "POST", body: JSON.stringify(payload) });
        router.push("/customers");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the customer");
      setPending(false);
    }
  }

  return (
    <form className="mx-auto max-w-xl space-y-4" onSubmit={save}>
      <Field label="Name"><input className={inputClass} required value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Email"><input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <Field label="Phone"><input className={inputClass} value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
      <Field label="Company"><input className={inputClass} value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
      <Field label="GSTIN" hint={gstin ? (isValidGstin(gstin) ? `State ${gstin.slice(0, 2)} · ${stateName(gstin.slice(0, 2))}` : "Checksum does not match") : "Optional. 15 characters."}>
        <input className={inputClass} value={gstin} maxLength={15} onChange={(event) => setGstin(event.target.value.toUpperCase())} />
      </Field>
      <Field label="Billing state">
        <select className={inputClass} value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
          <option value="">Not set</option>
          {GST_STATES.map((state) => (
            <option key={state.code} value={state.code}>{state.code} · {state.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Notes"><textarea className={inputClass} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <Button type="submit" loading={pending}>{pending ? "Saving…" : "Save customer"}</Button>
    </form>
  );
}
