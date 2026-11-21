import { Faq } from "@/components/faq";
import { Pricing } from "@/components/pricing";
import { SiteHeader } from "@/components/site-header";
import { landing } from "@/content/landing";
import { dashboardLinks } from "@/lib/links";

const featureMarks = ["01", "02", "03", "04", "05", "06", "07"];

export default function HomePage() {
  const { signup } = dashboardLinks();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "billflow",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: landing.shortDescription,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "INR",
    },
    publisher: {
      "@type": "Organization",
      name: "Genesix Solution Pvt Ltd",
    },
  };

  return (
    <div id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">Billing for India</p>
            <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight text-navy sm:text-6xl">
              {landing.headline}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-700">{landing.subheadline}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={signup} className="rounded-full bg-emerald px-6 py-3 text-center text-base font-semibold text-navy hover:bg-teal">
                {landing.primaryCta}
              </a>
              <a href="#features" className="rounded-full border border-slate-300 bg-white px-6 py-3 text-center text-base font-semibold text-navy hover:border-navy">
                {landing.secondaryCta}
              </a>
            </div>
          </div>
          <aside className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)]" aria-label="Sample invoice preview">
            <div className="flex items-center justify-between rounded-2xl bg-navy px-4 py-3 text-white">
              <span className="font-semibold">INV-0001</span>
              <span className="rounded-full bg-emerald px-2 py-1 text-xs font-bold text-navy">GST 18%</span>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Bookkeeping retainer</dt>
                <dd className="font-medium">₹20,000</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">CGST 9%</dt>
                <dd>₹1,800</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">SGST 9%</dt>
                <dd>₹1,800</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold text-navy">
                <dt>Total</dt>
                <dd>₹23,600</dd>
              </div>
            </dl>
            <p className="mt-5 rounded-2xl bg-emerald/15 px-4 py-3 text-sm font-medium text-navy">
              Pay by UPI · acme@okhdfcbank
            </p>
          </aside>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Features
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {landing.features.map((feature, index) => (
              <li
                key={feature.title}
                className={`rounded-3xl border border-slate-200 bg-white p-6 ${index === 0 ? "sm:col-span-2" : ""}`}
              >
                <p className="text-xs font-bold tracking-[0.18em] text-teal">{featureMarks[index]}</p>
                <h3 className="mt-3 text-xl font-semibold text-navy">{feature.title}</h3>
                <p className="mt-2 max-w-3xl leading-7 text-slate-700">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <Pricing />
        <Faq />

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="final-cta-heading">
          <div className="rounded-[32px] bg-navy px-6 py-14 text-center sm:px-12">
            <h2 id="final-cta-heading" className="mx-auto max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl">
              {landing.finalCta}
            </h2>
            <a
              href={signup}
              className="mt-8 inline-flex rounded-full bg-emerald px-6 py-3 font-semibold text-navy hover:bg-teal"
            >
              {landing.primaryCta}
            </a>
          </div>
        </section>
      </main>
      <footer className="bg-[#020617] text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_0.6fr]">
          <div>
            <img src="/brand/billflow-logo-horizontal-white.svg" alt="billflow" width={168} height={34} />
            <p className="mt-5 max-w-xl text-sm leading-7">{landing.about}</p>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-white">On this page</p>
            <ul className="mt-3 space-y-2">
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
              <li><a href={signup} className="hover:text-white">Start free</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
