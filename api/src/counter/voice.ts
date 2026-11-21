export interface VoiceLine {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  product_id: string | null;
}

const BN_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
};

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ek: 1, dui: 2,
  এক: 1, দুই: 2, তিন: 3, চার: 4, পাঁচ: 5, পাচ: 5, ছয়: 6, ছয়: 6, সাত: 7, আট: 8, নয়: 9, নয়: 9, দশ: 10,
  বিশ: 20, ত্রিশ: 30, চল্লিশ: 40, পঞ্চাশ: 50, ষাট: 60, সত্তর: 70, আশি: 80, নব্বই: 90,
  শত: 100, শো: 100,
};

const UNITS: Record<string, string> = {
  kg: 'kg', kilo: 'kg', kilogram: 'kg', কেজি: 'kg',
  g: 'g', gram: 'g', গ্রাম: 'g',
  l: 'l', litre: 'l', liter: 'l', লিটার: 'l',
  pcs: 'pcs', piece: 'pcs', পিস: 'pcs',
  dozen: 'dozen', ডজন: 'dozen',
};

export interface CatalogItem {
  id: string;
  name: string;
  price?: number;
  unit?: string;
}

function digits(text: string) {
  return text.replace(/[০-৯]/g, (char) => BN_DIGITS[char] ?? char);
}

function numberToken(token: string): number | null {
  const key = token.trim().toLowerCase();
  if (WORDS[key] !== undefined) return WORDS[key];
  if (WORDS[token.trim()] !== undefined) return WORDS[token.trim()];
  const normalized = digits(token).replace(/[^\d.]/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function matchProduct(name: string, catalog: CatalogItem[]) {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return catalog.find((item) => item.name.trim().toLowerCase() === needle)
    ?? catalog.find((item) => item.name.trim().toLowerCase().includes(needle) || needle.includes(item.name.trim().toLowerCase()))
    ?? null;
}

function parseChunk(chunk: string, catalog: CatalogItem[]): VoiceLine | null {
  const cleaned = chunk.replace(/[।.]/g, ' ').trim();
  if (!cleaned) return null;
  const priceMatch = cleaned.match(/([\d০-৯.]+|[^\s,]+)\s*(টাকা|taka|rupees|rs\.?)/i);
  const lineTotal = priceMatch ? numberToken(priceMatch[1]) ?? 0 : 0;
  const withoutPrice = priceMatch ? cleaned.slice(0, priceMatch.index).trim() : cleaned;
  const tokens = withoutPrice.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let quantity = 1;
  let unit = 'NOS';
  let start = 0;
  const first = numberToken(tokens[0]);
  if (first !== null) {
    quantity = first;
    start = 1;
    const unitKey = tokens[1]?.toLowerCase() ?? tokens[1];
    if (tokens[1] && (UNITS[unitKey] || UNITS[tokens[1]])) {
      unit = UNITS[unitKey] || UNITS[tokens[1]];
      start = 2;
    }
  }
  const description = tokens.slice(start).join(' ').replace(/[,،]+$/g, '').trim();
  if (!description) return null;
  const product = matchProduct(description, catalog);
  const unitPrice = product?.price && lineTotal === 0
    ? Number(product.price)
    : quantity > 0 && lineTotal > 0
      ? Math.round((lineTotal / quantity) * 100) / 100
      : lineTotal;
  return {
    description: product?.name ?? description,
    quantity,
    unit: product?.unit ?? unit,
    unit_price: unitPrice,
    line_total: lineTotal > 0 ? lineTotal : Math.round(quantity * unitPrice * 100) / 100,
    product_id: product?.id ?? null,
  };
}

export function parseVoiceTranscript(text: string, catalog: CatalogItem[] = []): VoiceLine[] {
  const parts = digits(text).split(/\s*(?:,|،| এবং | and )\s*/i);
  const lines: VoiceLine[] = [];
  for (const part of parts) {
    const priceOnly = part.trim().match(/^([\d০-৯.]+|[^\s]+)\s*(টাকা|taka|rupees|rs\.?)$/i);
    if (priceOnly && lines.length) {
      const total = numberToken(priceOnly[1]) ?? 0;
      const last = lines[lines.length - 1];
      last.line_total = total;
      last.unit_price = last.quantity > 0 ? Math.round((total / last.quantity) * 100) / 100 : total;
      continue;
    }
    const line = parseChunk(part, catalog);
    if (line) lines.push(line);
  }
  return lines;
}
