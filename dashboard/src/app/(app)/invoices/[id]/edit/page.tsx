"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TemplatePicker } from "@/components/template-picker";
import { Button, ErrorNote, Field, Loading, inputClass } from "@/components/ui";
import { authed } from "@/lib/api";
import { invoiceTemplate, isTemplateKey, persistInvoiceTemplate, type TemplateKey } from "@/lib/templates";
import type { Invoice } from "@/lib/types";

export default function EditInvoicePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [due, setDue] = useState("");
  const [discount, setDiscount] = useState("0");
  const [place, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [template, setTemplate] = useState<TemplateKey>("classic");

  useEffect(() => {
    authed<Invoice>(`/invoices/${params.id}`)
      .then((row) => {
        setInvoice(row);
        setNotes(row.notes ?? "");
        setTerms(row.terms ?? "");
        setDue(row.due_at ? row.due_at.slice(0, 10) : "");
        setDiscount(String(row.discount ?? 0));
        setPlace(row.place_of_supply ?? "");
        setTemplate(isTemplateKey(row.template_key) ? row.template_key : invoiceTemplate(row.id));
      })
      .catch((reason: Error) => setError(reason.message));
  }, [params.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authed(`/invoices/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes,
          terms,
          place_of_supply: place,
          discount: Number(discount || 0),
          due_at: due ? new Date(due).toISOString() : undefined,
        }),
      });
      try {
        await persistInvoiceTemplate(params.id, template);
      } catch {
        // Kept locally when the template column is not live yet.
      }
      router.push(`/invoices/${params.id}?saved=1`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save");
      setPending(false);
    }
  }

  if (error && !invoice) return <ErrorNote message={error} />;
  if (!invoice) return <Loading />;

  return (
    <form className="mx-auto max-w-xl space-y-4" onSubmit={save}>
      <h1 className="text-2xl font-bold">Edit {invoice.number}</h1>
      <TemplatePicker value={template} onChange={setTemplate} />
      <p className="text-sm text-slate-600">Line items stay as they were saved. You can still change the note, due date, and discount.</p>
      <Field label="Due date"><input className={inputClass} type="date" value={due} onChange={(event) => setDue(event.target.value)} /></Field>
      <Field label="Place of supply"><input className={inputClass} value={place} onChange={(event) => setPlace(event.target.value)} /></Field>
      <Field label="Discount"><input className={inputClass} inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} /></Field>
      <Field label="Notes"><textarea className={inputClass} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      <Field label="Terms"><textarea className={inputClass} rows={3} value={terms} onChange={(event) => setTerms(event.target.value)} /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
    </form>
  );
}
