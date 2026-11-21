export const TEMPLATE_KEYS = ["classic", "modern", "minimal", "bold", "thermal_58", "thermal_80", "bengali"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateInfo {
  key: TemplateKey;
  name: string;
  detail: string;
  feature: string;
}

/** Classic is on every plan. The rest follow the custom_templates entitlement. */
export const TEMPLATES: TemplateInfo[] = [
  { key: "classic", name: "Classic", detail: "A bordered tax invoice.", feature: "" },
  { key: "modern", name: "Modern", detail: "Split header and a teal rule.", feature: "custom_templates" },
  { key: "minimal", name: "Minimal", detail: "Type, space, and the total.", feature: "custom_templates" },
  { key: "bold", name: "Bold colour band", detail: "Emerald band across the top.", feature: "custom_templates" },
  { key: "thermal_58", name: "Thermal 58mm", detail: "Narrow receipt for a 58mm printer.", feature: "custom_templates" },
  { key: "thermal_80", name: "Thermal 80mm", detail: "Receipt width for an 80mm printer.", feature: "custom_templates" },
  { key: "bengali", name: "Bengali-first", detail: "চালান set in Tiro Bangla.", feature: "custom_templates" },
];

const DEFAULT_KEY = "billflow-default-template";

export function isTemplateKey(value: string | null | undefined): value is TemplateKey {
  return TEMPLATE_KEYS.includes(value as TemplateKey);
}

export function defaultTemplate(): TemplateKey {
  if (typeof window === "undefined") return "classic";
  const saved = localStorage.getItem(DEFAULT_KEY);
  return isTemplateKey(saved) ? saved : "classic";
}

export function setDefaultTemplate(key: TemplateKey) {
  localStorage.setItem(DEFAULT_KEY, key);
}

export function invoiceTemplate(id: string): TemplateKey {
  if (typeof window === "undefined") return defaultTemplate();
  const saved = localStorage.getItem(`billflow-invoice-template:${id}`);
  return isTemplateKey(saved) ? saved : defaultTemplate();
}

export function setInvoiceTemplate(id: string, key: TemplateKey) {
  localStorage.setItem(`billflow-invoice-template:${id}`, key);
}

export async function persistDefaultTemplate(key: TemplateKey) {
  setDefaultTemplate(key);
  const { authed } = await import("./api");
  await authed("/tenants/current", { method: "PATCH", body: JSON.stringify({ default_template: key }) });
}

export async function persistInvoiceTemplate(id: string, key: TemplateKey) {
  setInvoiceTemplate(id, key);
  const { authed } = await import("./api");
  await authed(`/invoices/${id}`, { method: "PATCH", body: JSON.stringify({ template_key: key }) });
}

export interface SheetItem {
  description: string;
  qty: number;
  rate: number;
  total: number;
}

export interface SheetInvoice {
  number: string;
  seller: string;
  sellerGstin?: string | null;
  buyer: string;
  items: SheetItem[];
  taxable: number;
  tax: number;
  total: number;
  note?: string;
}

export const SAMPLE_INVOICE: SheetInvoice = {
  number: "INV2627000000007",
  seller: "Saffron Test Traders",
  sellerGstin: "27AAPFU0939F1ZV",
  buyer: "Mehta & Co",
  items: [
    { description: "Consulting hour", qty: 1, rate: 1000, total: 1180 },
    { description: "ক্ষমা", qty: 1, rate: 200, total: 236 },
  ],
  taxable: 1200,
  tax: 216,
  total: 1416,
  note: "Sample for the gallery. ক্ষ জ্ঞ ন্তু স্ত্র",
};

export const BENGALI_SAMPLE: SheetInvoice = {
  ...SAMPLE_INVOICE,
  number: "চালান ০০০৭",
  buyer: "মেহতা অ্যান্ড কোং",
  items: [
    { description: "ক্ষমা", qty: 1, rate: 200, total: 236 },
    { description: "জ্ঞান", qty: 1, rate: 400, total: 472 },
    { description: "ন্তু", qty: 2, rate: 50, total: 118 },
    { description: "স্ত্র", qty: 1, rate: 80, total: 94 },
  ],
  taxable: 780,
  tax: 140,
  total: 920,
  note: "ক্ষ · জ্ঞ · ন্তু · স্ত্র",
};
