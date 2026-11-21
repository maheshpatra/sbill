import { InvoiceSheet } from "@/components/invoice-sheet";
import { BENGALI_SAMPLE } from "@/lib/templates";

const clusters = ["ক্ষ", "জ্ঞ", "ন্তু", "স্ত্র"];

export default function TypographyProofPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 bg-white px-6 py-10 text-navy">
      <h1 className="text-4xl">বাংলা টাইপ</h1>
      <p className="text-lg">Hind Siliguri for the interface. Baloo Da 2 for headings. Tiro Bangla on the bill.</p>
      <section>
        <h2 className="text-3xl">ক্ষমা, জ্ঞান, গ্রন্থ, স্তর</h2>
        <p className="mt-3 text-2xl">{clusters.join("  ")}</p>
        <p className="font-invoice mt-4 text-3xl">{clusters.join("  ")}</p>
      </section>
      <InvoiceSheet template="bengali" invoice={BENGALI_SAMPLE} />
    </main>
  );
}
