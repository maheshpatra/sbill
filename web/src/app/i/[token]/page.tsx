import { buildUpiUri, upiQrSvg } from "@billflow/upi";

export default async function SharedInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4317";
  const response = await fetch(`${api}/public/invoices/${token}`, { cache: "no-store" });
  if (!response.ok) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-bold text-navy">This invoice link is not available</h1>
        <p className="mt-2 text-slate-600">It may have expired or been revoked.</p>
      </main>
    );
  }
  const invoice = (await response.json()) as {
    number: string;
    total: string | number;
    amount_in_words?: string;
    seller?: { name?: string; gstin?: string };
    buyer?: { name?: string };
    items?: Array<{ description: string; line_total: string | number }>;
    upi?: { pa: string; pn: string; am: number | string; tn?: string; tr: string } | null;
  };
  const upi = invoice.upi?.pa && invoice.upi.tr
    ? { ...invoice.upi, cu: "INR" as const }
    : null;
  const qr = upi ? await upiQrSvg(upi) : "";
  const uri = upi ? buildUpiUri(upi) : "";
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-sm text-teal">billflow</p>
      <h1 className="mt-2 text-3xl font-bold text-navy">{invoice.number}</h1>
      <p className="mt-2">{invoice.seller?.name}</p>
      <p className="text-sm text-slate-600">{invoice.seller?.gstin}</p>
      <p className="mt-6 text-sm">Bill to {invoice.buyer?.name}</p>
      <ul className="mt-4 space-y-2 text-sm">
        {(invoice.items ?? []).map((item) => (
          <li key={item.description} className="flex justify-between">
            <span>{item.description}</span>
            <span>{item.line_total}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xl font-bold">INR {invoice.total}</p>
      {invoice.amount_in_words ? <p className="text-sm text-slate-600">{invoice.amount_in_words}</p> : null}
      {qr ? (
        <div className="mt-8">
          <h2 className="font-semibold">Pay with UPI</h2>
          <div className="mt-3 w-52" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-2 break-all text-xs text-slate-500">{uri}</p>
        </div>
      ) : null}
    </main>
  );
}
