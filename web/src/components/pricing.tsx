"use client";

import { useEffect, useState } from "react";
import { createBillflowClient } from "@billflow/api-client";
import { formatInr, pricing, yearlyPrice } from "@/config/pricing";
import { landing } from "@/content/landing";
import { dashboardLinks } from "@/lib/links";

interface LivePlan {
  code: string;
  name: string;
  description?: string;
  price_monthly?: number | string;
  price_yearly?: number | string;
  sort_order?: number;
}

interface CardPlan {
  id: string;
  name: string;
  monthly: number;
  yearly: number;
  summary: string;
  highlighted: boolean;
}

function fallbackPlans(): CardPlan[] {
  return pricing.plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    monthly: plan.monthlyPrice,
    yearly: yearlyPrice(plan.monthlyPrice),
    summary: plan.summary,
    highlighted: plan.highlighted,
  }));
}

export function Pricing() {
  const [yearly, setYearly] = useState(false);
  const [plans, setPlans] = useState<CardPlan[]>(fallbackPlans);
  const [live, setLive] = useState(false);
  const { signup } = dashboardLinks();

  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4317";
    const client = createBillflowClient({ baseUrl });
    void client
      .GET("/billing/plans", { parseAs: "json" })
      .then(async (result) => {
        if (!result.response.ok) return;
        const body = (result.data ?? (await result.response.json().catch(() => null))) as { data?: LivePlan[] } | null;
        if (!body?.data?.length) return;
        const next = [...body.data]
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((plan) => {
            const monthly = Number(plan.price_monthly ?? 0);
            const yearlyAmount = Number(plan.price_yearly ?? 0) || yearlyPrice(monthly);
            const known = pricing.plans.find((row) => row.id === plan.code);
            return {
              id: plan.code,
              name: plan.name,
              monthly,
              yearly: yearlyAmount,
              summary: plan.description || known?.summary || "",
              highlighted: plan.code === "growth",
            };
          });
        setPlans(next);
        setLive(true);
      })
      .catch(() => undefined);
  }, []);

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="pricing-heading">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <h2 id="pricing-heading" className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Pricing
          </h2>
          <p className="mt-3 text-lg text-slate-700">{landing.yearlyNote}</p>
          <p className="mt-1 text-sm text-slate-500">{live ? "Prices from the live plan catalog. GST extra." : "Listed prices. GST extra."}</p>
        </div>
        <div className="inline-flex rounded-full border border-slate-300 bg-white p-1" role="group" aria-label="Billing period">
          <button
            type="button"
            aria-pressed={!yearly}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${yearly ? "text-slate-600" : "bg-navy text-white"}`}
            onClick={() => setYearly(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-pressed={yearly}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${yearly ? "bg-navy text-white" : "text-slate-600"}`}
            onClick={() => setYearly(true)}
          >
            Yearly
          </button>
        </div>
      </div>
      <ul className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const amount = yearly ? plan.yearly : plan.monthly;
          const priceLabel = amount === 0 ? "Free" : formatInr(amount);
          const period = amount === 0 ? "" : yearly ? "/year" : "/month";
          return (
            <li
              key={plan.id}
              className={`flex flex-col rounded-3xl border p-6 ${
                plan.highlighted ? "border-navy bg-navy text-white shadow-xl" : "border-slate-200 bg-white"
              }`}
            >
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">{priceLabel}</span>
                {period ? <span className={plan.highlighted ? "text-slate-300" : "text-slate-500"}>{period}</span> : null}
              </p>
              <p className={`mt-4 flex-1 text-sm leading-6 ${plan.highlighted ? "text-slate-200" : "text-slate-600"}`}>
                {plan.summary}
              </p>
              <a
                href={signup}
                className={`mt-8 rounded-full px-4 py-3 text-center text-sm font-semibold ${
                  plan.highlighted ? "bg-emerald text-navy hover:bg-teal" : "bg-navy text-white hover:bg-slate-800"
                }`}
              >
                {landing.primaryCta}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
