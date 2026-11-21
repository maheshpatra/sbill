import { InvoiceForm } from "@/components/invoice-form";

export default function NewInvoicePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">New invoice</h1>
      <p className="text-sm text-slate-600">Totals are worked out here and again on the server. GST is tax-exclusive.</p>
      <InvoiceForm />
    </div>
  );
}
