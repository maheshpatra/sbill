import QRCode from 'qrcode';

export interface UpiPayee {
  /** Virtual payment address, for example acme@okhdfcbank */
  pa: string;
  /** Payee name shown in the UPI app */
  pn: string;
  /** Amount in rupees. Omitted for a free-amount collect request. */
  am?: number | string;
  cu?: string;
  /** Transaction note, truncated to 50 characters. */
  tn?: string;
  /** Transaction reference. Unique per payment attempt. */
  tr?: string;
}

/** NPCI-style VPA: local part, @, and an alphabetic handle. */
export const UPI_VPA = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 4, width: 280 };

export function formatUpiAmount(value: number | string): string {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error('invalid UPI amount');
  }
  const [whole, frac = ''] = text.split('.');
  const digits = `${frac}000`;
  let paise = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) paise += 1;
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return `${rupees}.${String(rem).padStart(2, '0')}`;
}

export function buildUpiUri(input: UpiPayee): string {
  const pa = input.pa?.trim();
  const pn = input.pn?.trim();
  if (!pa || !UPI_VPA.test(pa)) {
    throw new Error('invalid UPI VPA');
  }
  if (!pn) {
    throw new Error('payee name is required');
  }
  const params = new URLSearchParams();
  params.set('pa', pa);
  params.set('pn', pn);
  if (input.am !== undefined && input.am !== null && `${input.am}` !== '') {
    params.set('am', formatUpiAmount(input.am));
  }
  if (input.tn?.trim()) {
    params.set('tn', Array.from(input.tn.trim()).slice(0, 50).join(''));
  }
  if (input.tr?.trim()) params.set('tr', input.tr.trim());
  params.set('cu', input.cu ?? 'INR');
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

export function upiQrDataUrl(input: UpiPayee): Promise<string> {
  return QRCode.toDataURL(buildUpiUri(input), QR_OPTIONS);
}

export function upiQrSvg(input: UpiPayee): Promise<string> {
  return QRCode.toString(buildUpiUri(input), { ...QR_OPTIONS, type: 'svg' });
}

export function upiQrPng(input: UpiPayee): Promise<Buffer> {
  return QRCode.toBuffer(buildUpiUri(input), { ...QR_OPTIONS, type: 'png' });
}

export function linkQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' });
}
