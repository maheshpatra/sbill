"use client";

import { useState } from "react";
import { landing } from "@/content/landing";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">
        FAQ
      </h2>
      <div className="mt-8 divide-y divide-slate-200 rounded-3xl border border-slate-200 bg-white">
        {landing.faq.map((item, index) => {
          const expanded = open === index;
          const panelId = `faq-panel-${index}`;
          return (
            <div key={item.q}>
              <h3>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-base font-semibold text-navy"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? null : index)}
                >
                  {item.q}
                  <span aria-hidden className="text-xl text-teal">
                    {expanded ? "–" : "+"}
                  </span>
                </button>
              </h3>
              <div id={panelId} role="region" hidden={!expanded} className="px-5 pb-5 text-slate-700">
                {item.a}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
