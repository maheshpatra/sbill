/** Placeholder prices. Change these without touching the page copy. */

export type PlanId = "free" | "starter" | "growth" | "business";

export interface PlanPrice {
  id: PlanId;
  name: string;
  /** Rupees per month. Zero is shown as Free. */
  monthlyPrice: number;
  /** Feature line from the approved pricing copy. */
  summary: string;
  highlighted: boolean;
}

export const pricing = {
  /** "Save 2 months when you pay yearly." */
  monthsFreeOnYearly: 2,
  plans: [
    {
      id: "free",
      name: "Free",
      monthlyPrice: 0,
      summary: "1 user, 20 invoices a month, and a public page on your subdomain.",
      highlighted: false,
    },
    {
      id: "starter",
      name: "Starter",
      monthlyPrice: 199,
      summary: "GST invoices, a product catalog, UPI links, and WhatsApp click-to-chat.",
      highlighted: false,
    },
    {
      id: "growth",
      name: "Growth",
      monthlyPrice: 499,
      summary: "Reminders, the counter, online payments, roles, stock, and reports.",
      highlighted: true,
    },
    {
      id: "business",
      name: "Business",
      monthlyPrice: 1499,
      summary: "Custom templates and domains, the WhatsApp API, and higher limits.",
      highlighted: false,
    },
  ] satisfies PlanPrice[],
} as const;

export function yearlyPrice(monthlyPrice: number): number {
  return monthlyPrice * (12 - pricing.monthsFreeOnYearly);
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
