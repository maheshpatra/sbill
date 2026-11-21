import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { label } from '../counter/labels';

export interface PdfInvoice {
  number?: string;
  total?: number | string;
  locale?: string;
  template_key?: string | null;
  default_template?: string | null;
  logo?: Buffer | null;
  cgst_total?: number | string;
  sgst_total?: number | string;
  igst_total?: number | string;
  items?: Array<Record<string, unknown>>;
  qr?: Buffer | null;
}

const BENGALI_FONT = join(__dirname, '..', '..', 'assets', 'fonts', 'HindSiliguri-Regular.ttf');

export function resolveTemplateKey(invoice: PdfInvoice) {
  return invoice.template_key || invoice.default_template || 'classic';
}

export function pageSize(key: string): [number, number] | 'A4' {
  if (key === 'thermal_58') return [164, 600];
  if (key === 'thermal_80') return [227, 700];
  return 'A4';
}

export function renderInvoicePdf(invoice: PdfInvoice, words: string): Promise<Buffer> {
  const key = resolveTemplateKey(invoice);
  const locale = key === 'bengali' ? 'bn' : String(invoice.locale || 'en');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: pageSize(key), margin: key.startsWith('thermal') ? 8 : 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if ((key === 'bengali' || locale === 'bn') && existsSync(BENGALI_FONT)) {
      doc.registerFont('Bengali', BENGALI_FONT);
      doc.font('Bengali');
    }
    if (invoice.logo && invoice.logo.length > 0) {
      try {
        doc.image(invoice.logo, { fit: [120, 48] });
        doc.moveDown(0.4);
      } catch {
        // A bad logo must not block the bill.
      }
    }
    const titleSize = key === 'bold' ? 28 : key === 'minimal' ? 12 : 18;
    if (key === 'modern') doc.rect(0, 0, doc.page.width, 8).fill('#0f766e');
    doc.fillColor('#111').fontSize(titleSize).text(label(locale, 'invoice'));
    doc.fontSize(key.startsWith('thermal') ? 9 : 12).text(`No. ${invoice.number ?? ''}`);
    doc.text(`${label(locale, 'total')} INR ${invoice.total ?? ''}`);
    if (key === 'bold') doc.fontSize(22).text(String(invoice.total ?? ''));
    if (!key.startsWith('thermal')) {
      doc.fontSize(11).text(words);
      doc.text(`CGST ${invoice.cgst_total ?? 0}  SGST ${invoice.sgst_total ?? 0}  IGST ${invoice.igst_total ?? 0}`);
    }
    if (invoice.qr && invoice.qr.length > 0 && !key.startsWith('thermal')) {
      doc.moveDown(0.4).fontSize(11).text(label(locale, 'pay_upi'));
      try {
        doc.image(invoice.qr, { width: 120 });
      } catch {
        // Ignore a QR that pdfkit cannot embed.
      }
    }
    for (const item of invoice.items ?? []) {
      doc.fontSize(key.startsWith('thermal') ? 8 : 11).text(
        `${item.description}  ${item.quantity} x ${item.unit_price} = ${item.line_total}`,
      );
    }
    doc.end();
  });
}
