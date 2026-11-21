"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authed } from "@/lib/api";
import { Button, ErrorNote, Field, inputClass } from "./ui";

export function CustomerForm({
  id,
  initial,
}: {
  id?: string;
  initial?: { name: string; email: string; phone: string; company: string; gstin: string; notes: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [gstin, setGstin] = useState(initial?.gstin ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const payload = { name, email: email || undefined, phone, company, gstin: gstin || undefined, notes };
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
      <Field label="GSTIN"><input className={inputClass} value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase())} /></Field>
      <Field label="Notes"><textarea className={inputClass} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save customer"}</Button>
    </form>
  );
}
