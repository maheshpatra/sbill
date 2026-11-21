"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { authed } from "@/lib/api";
import { num } from "@/lib/money";
import { readLogo } from "@/lib/brand-assets";
import { invoiceTemplate, isTemplateKey, type SheetInvoice, type TemplateKey } from "@/lib/templates";
import type { Invoice, Tenant } from "@/lib/types";

export default function PrintInvoiceRoute() {
  return (
    <Suspense fallback={<p className="p-6">Loading the bill…</p>}>
      <PrintInvoicePage />
    </Suspense>
  );
}

function PrintInvoicePage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const requested = search.get("template");
  const template: TemplateKey = isTemplateKey(requested) ? requested : invoiceTemplate(params.id);
  const [sheet, setSheet] = useState<SheetInvoice | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLogo(readLogo());
    document.body.dataset.printTemplate = template;
    Promise.all([authed<Invoice>(`/invoices/${params.id}`), authed<Tenant>("/tenants/current").catch(() => null)])
      .then(([invoice, tenant]) => {
        const items = (invoice.items ?? []).map((item) => ({
          description: item.description,
          qty: num(item.quantity),
          rate: num(item.unit_price),
          total: num(item.line_total),
        }));
        setSheet({
          number: invoice.number,
          seller: tenant?.legal_name || tenant?.name || "Your business",
          sellerGstin: tenant?.gstin,
          buyer: invoice.customer?.name || "Customer",
          items: items.length ? items : [{ description: "Bill", qty: 1, rate: num(invoice.total), total: num(invoice.total) }],
          taxable: num(invoice.amount),
          tax: num(invoice.tax),
          total: num(invoice.total),
          note: invoice.notes ?? undefined,
        });
      })
      .catch((reason: Error) => setError(reason.message));
    return () => {
      delete document.body.dataset.printTemplate;
    };
  }, [params.id, template]);

  const pageSize = template === "thermal_58" ? "58mm auto" : template === "thermal_80" ? "80mm auto" : "A4";

  return (
    <main className="mx-auto max-w-3xl bg-white p-6">
      <style>{`@page { size: ${pageSize}; margin: 6mm; }`}</style>
      <div className="no-print mb-4 flex gap-2">
        <button type="button" className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white" onClick={() => window.print()}>
          Print / PDF
        </button>
      </div>
      {error ? <p>{error}</p> : null}
      {sheet ? <InvoiceSheet template={template} invoice={sheet} logo={logo} /> : <p>Loading the bill…</p>}
    </main>
  );
}
