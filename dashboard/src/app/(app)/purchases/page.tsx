"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, ErrorNote, Field, Loading, inputClass } from "@/components/ui";
import { authed, NOT_IN_THIS_ENVIRONMENT } from "@/lib/api";
import { inr, num } from "@/lib/money";

interface Line {
  description: string;
  quantity: string;
  unit_price: string;
  gst_rate: string;
}

interface Purchase {
  id: string;
  supplier: string | null;
  bill_date: string | null;
  photo_ref: string | null;
  notes: string | null;
  taxable: number | string;
  tax: number | string;
  total: number | string;
  lines?: Array<{ id: string; description: string; quantity: number; unit_price: number; gst_rate: number; line_total: number }>;
}

const emptyLine = (): Line => ({ description: "", quantity: "1", unit_price: "", gst_rate: "18" });

export default function PurchasesPage() {
  const [rows, setRows] = useState<Purchase[]>([]);
  const [supplier, setSupplier] = useState("");
  const [billDate, setBillDate] = useState("");
  const [photoRef, setPhotoRef] = useState("");
  const [gstRate, setGstRate] = useState("18");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    authed<{ data: Purchase[] }>("/purchases")
      .then((page) => setRows(page.data ?? []))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const preview = useMemo(() => {
    return lines.reduce(
      (sum, line) => {
        const taxable = num(line.quantity) * num(line.unit_price);
        const tax = (taxable * num(line.gst_rate || gstRate)) / 100;
        return { taxable: sum.taxable + taxable, tax: sum.tax + tax };
      },
      { taxable: 0, tax: 0 },
    );
  }, [lines, gstRate]);

  function body() {
    return {
      supplier: supplier.trim() || undefined,
      bill_date: billDate || undefined,
      gst_rate: Number(gstRate || 0),
      photo_ref: photoRef.trim() || undefined,
      lines: lines
        .filter((line) => line.description.trim())
        .map((line) => ({
          description: line.description.trim(),
          quantity: Number(line.quantity || 0),
          unit_price: Number(line.unit_price || 0),
          gst_rate: Number(line.gst_rate || gstRate || 0),
        })),
    };
  }

  async function readPhoto(file: File) {
    setError(null);
    setNotice(null);
    const data = await file.arrayBuffer();
    const bytes = new Uint8Array(data);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    try {
      const parsed = await authed<{ supplier?: string | null; lines?: Array<{ description: string; quantity?: number; unit_price?: number; line_total?: number }> }>("/purchases/parse", {
        method: "POST",
        body: JSON.stringify({ image_base64: btoa(binary), filename: file.name }),
      });
      if (parsed.supplier) setSupplier(parsed.supplier);
      if (parsed.lines?.length) {
        setLines(
          parsed.lines.map((line) => ({
            description: line.description,
            quantity: String(line.quantity ?? 1),
            unit_price: String(line.unit_price ?? line.line_total ?? ""),
            gst_rate: gstRate,
          })),
        );
      }
      setPhotoRef(file.name);
      setReview(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setError(/not configured|503|not set up/i.test(message) ? "Reading a bill photo is not set up yet. Enter the bill below." : message);
    }
  }

  async function save() {
    const payload = body();
    if (!payload.lines.length) {
      setError("Add at least one line.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authed("/purchases", { method: "POST", body: JSON.stringify(payload) });
      setNotice("Purchase saved.");
      setSupplier("");
      setBillDate("");
      setPhotoRef("");
      setLines([emptyLine()]);
      setReview(false);
      load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not save the purchase";
      setError(message === NOT_IN_THIS_ENVIRONMENT ? message : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Purchases</h1>
        <p className="mt-1 text-sm text-slate-600">Record a supplier bill. A photo can fill the form when reading is set up.</p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm">{notice}</p> : null}
      <Card>
        <h2 className="font-semibold">{review ? "Review purchase" : "New purchase"}</h2>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!review) {
              setReview(true);
              return;
            }
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier">
              <input className={inputClass} value={supplier} onChange={(event) => setSupplier(event.target.value)} />
            </Field>
            <Field label="Bill date">
              <input className={inputClass} type="date" value={billDate} onChange={(event) => setBillDate(event.target.value)} />
            </Field>
            <Field label="GST %">
              <input className={inputClass} inputMode="decimal" value={gstRate} onChange={(event) => setGstRate(event.target.value)} />
            </Field>
            <Field label="Photo reference">
              <input className={inputClass} value={photoRef} onChange={(event) => setPhotoRef(event.target.value)} placeholder="Filename or note" />
            </Field>
          </div>
          <label className="block text-sm font-medium">
            Bill photo
            <input
              className="mt-1 block w-full text-sm"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readPhoto(file);
              }}
            />
          </label>
          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_80px_110px_80px]">
                <input className={inputClass} required placeholder="Item" value={line.description} onChange={(event) => setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, description: event.target.value } : row)))} />
                <input className={inputClass} inputMode="decimal" aria-label="Quantity" value={line.quantity} onChange={(event) => setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, quantity: event.target.value } : row)))} />
                <input className={inputClass} inputMode="decimal" aria-label="Price" placeholder="Price" value={line.unit_price} onChange={(event) => setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, unit_price: event.target.value } : row)))} />
                <input className={inputClass} inputMode="decimal" aria-label="GST percent" value={line.gst_rate} onChange={(event) => setLines((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, gst_rate: event.target.value } : row)))} />
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>
          <div className="rounded-2xl bg-[#f4f6f5] px-4 py-3 text-sm">
            <p>Taxable {inr(preview.taxable)}</p>
            <p>GST {inr(preview.tax)}</p>
            <p className="text-lg font-bold">Total {inr(preview.taxable + preview.tax)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {review ? <Button type="button" variant="ghost" onClick={() => setReview(false)}>Edit</Button> : null}
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : review ? "Save purchase" : "Review"}</Button>
          </div>
        </form>
      </Card>
      {loading ? <Loading label="Loading purchases" /> : null}
      {!loading && rows.length === 0 ? <Empty title="No purchases yet" body="A saved supplier bill will show up here." /> : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{row.supplier || "Supplier"}</p>
                <p className="font-semibold">{inr(row.total)}</p>
              </div>
              <p className="text-slate-500">{[row.bill_date, row.photo_ref, `GST ${inr(row.tax)}`].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
