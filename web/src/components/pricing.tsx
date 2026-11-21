"use client";

import { useState } from "react";
import { formatInr, pricing, yearlyPrice } from "@/config/pricing";
import { landing } from "@/content/landing";
import { dashboardLinks } from "@/lib/links";

export function Pricing() {
  const [yearly, setYearly] = useState(false);
  const { signup } = dashboardLinks();

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="pricing-heading">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <h2 id="pricing-heading" className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Pricing
          </h2>
          <p className="mt-3 text-lg text-slate-700">{landing.yearlyNote}</p>
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
        {pricing.plans.map((plan) => {
          const amount = yearly ? yearlyPrice(plan.monthlyPrice) : plan.monthlyPrice;
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
