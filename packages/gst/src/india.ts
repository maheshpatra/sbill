const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GSTIN checksum from the first 14 characters. Factor alternates 1, 2 from the left. */
export function gstinChecksum(body14: string): string {
  if (body14.length !== 14) throw new Error("GSTIN body must be 14 characters");
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const code = GSTIN_CHARS.indexOf(body14[i].toUpperCase());
    if (code < 0) throw new Error("GSTIN has an invalid character");
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(value: string | null | undefined): boolean {
  if (!value) return false;
  const gstin = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  return gstinChecksum(gstin.slice(0, 14)) === gstin[14];
}

export function financialYear(on: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(on);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const start = month >= 4 ? year : year - 1;
  const yy = (value: number) => String(value).slice(-2);
  return `${yy(start)}${yy(start + 1)}`;
}

/** Gapless number, at most 16 characters: prefix + FY (4) + sequence. */
export function formatFyInvoiceNumber(prefix: string, fy: string, sequence: number): string {
  const clean = prefix.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || "INV";
  const width = Math.max(3, 16 - clean.length - fy.length);
  const number = `${clean}${fy}${String(sequence).padStart(width, "0")}`;
  if (number.length > 16) throw new Error("invoice number exceeds 16 characters");
  return number;
}

export function supplyFromStates(sellerState: string | null | undefined, buyerState: string | null | undefined): "intra" | "inter" {
  const seller = (sellerState ?? "").trim();
  const buyer = (buyerState ?? "").trim();
  if (!seller || !buyer || seller === buyer) return "intra";
  return "inter";
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const ten = TENS[Math.floor(n / 10)];
  const one = ONES[n % 10];
  return one ? `${ten} ${one}` : ten;
}

function threeDigits(n: number): string {
  if (n < 100) return twoDigits(n);
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${twoDigits(rest)}` : ""}`;
}

/** Indian grouping: crore, lakh, thousand, hundred. */
export function rupeesInWords(amount: number | string): string {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error("amount must be a non-negative number");
  const rupees = Math.floor(value + 1e-8);
  const paise = Math.round((value - rupees) * 100);
  const chunks: Array<[number, string]> = [
    [10000000, "Crore"],
    [100000, "Lakh"],
    [1000, "Thousand"],
  ];
  let rest = rupees;
  const parts: string[] = [];
  for (const [size, label] of chunks) {
    const count = Math.floor(rest / size);
    if (count) {
      parts.push(`${threeDigits(count)} ${label}`);
      rest %= size;
    }
  }
  if (rest) parts.push(threeDigits(rest));
  const rupeeWords = parts.length ? parts.join(" ") : "Zero";
  const paiseWords = paise ? ` and ${twoDigits(paise)} Paise` : "";
  return `Rupees ${rupeeWords}${paiseWords} Only`;
}
