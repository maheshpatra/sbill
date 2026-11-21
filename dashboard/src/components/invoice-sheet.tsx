import { inr } from "@/lib/money";
import { BENGALI_SAMPLE, SAMPLE_INVOICE, type SheetInvoice, type TemplateKey } from "@/lib/templates";

export function InvoiceSheet({
  template,
  invoice,
  logo,
}: {
  template: TemplateKey;
  invoice?: SheetInvoice;
  logo?: string | null;
}) {
  const sheet = invoice ?? (template === "bengali" ? BENGALI_SAMPLE : SAMPLE_INVOICE);
  const mark = logo ?? null;
  const bn = template === "bengali";
  const thermal = template === "thermal_58" || template === "thermal_80";
  return (
    <article className={`invoice-sheet invoice-${template}`} data-template={template}>
      {template === "bold" ? <div className="invoice-band">{bn ? "চালান" : sheet.seller}</div> : null}
      <header className="invoice-head">
        {mark ? <img src={mark} alt="" className="invoice-logo" /> : <span className="invoice-mark" aria-hidden>b</span>}
        <div>
          <p className="invoice-kicker">{sheet.seller}</p>
          <h2 className="font-invoice">{bn ? "চালান" : thermal ? "RECEIPT" : "Tax invoice"}</h2>
          <p>{sheet.number}</p>
          {sheet.sellerGstin ? <p className="invoice-meta">GSTIN {sheet.sellerGstin}</p> : null}
        </div>
      </header>
      <p className="invoice-buyer">{bn ? "ক্রেতা" : "Bill to"} {sheet.buyer}</p>
      {thermal ? (
        <ul className="invoice-lines">
          {sheet.items.map((item) => (
            <li key={item.description}>
              <span>{item.description} × {item.qty}</span>
              <span>{inr(item.total)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <table className="invoice-table">
          <thead>
            <tr>
              <th>{bn ? "বিবরণ" : "Description"}</th>
              <th>{bn ? "পরিমাণ" : "Qty"}</th>
              <th>{bn ? "মোট" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.items.map((item) => (
              <tr key={item.description}>
                <td>{item.description}</td>
                <td>{item.qty}</td>
                <td>{inr(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="invoice-total">{bn ? "মোট" : "Total"} {inr(sheet.total)}</p>
      <p className="invoice-meta">{bn ? "কর" : "GST"} {inr(sheet.tax)} · {bn ? "করযোগ্য" : "Taxable"} {inr(sheet.taxable)}</p>
      {sheet.note ? <p className="invoice-note">{sheet.note}</p> : null}
    </article>
  );
}
