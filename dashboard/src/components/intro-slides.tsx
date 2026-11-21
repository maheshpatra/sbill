"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Shield, Smartphone, Wallet } from "lucide-react";

const SEEN = "billflow-intro-seen";

const slides = [
  {
    icon: Smartphone,
    title: "A new bill in three taps",
    body: "Pick the goods, then collect cash or UPI. The counter is built for a phone in one hand.",
  },
  {
    icon: Wallet,
    title: "Cash, change, and UPI",
    body: "The amount tendered and the change sit on the bill. A UPI QR uses your own VPA.",
  },
  {
    icon: BookOpen,
    title: "খাতা, বাকি, জমা",
    body: "Switch the books to Bengali. Dues, sales, and what you have received use everyday words.",
  },
  {
    icon: Shield,
    title: "Your books stay yours",
    body: "Each business is its own tenant. Staff can look. Only the owner changes the books.",
  },
];

export function introSeen() {
  return typeof window !== "undefined" && localStorage.getItem(SEEN) === "1";
}

export function markIntroSeen() {
  localStorage.setItem(SEEN, "1");
}

export function IntroSlides({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);
  const slide = slides[index];
  const Icon = slide.icon;
  const last = index === slides.length - 1;

  function go(next: number) {
    setIndex(Math.min(slides.length - 1, Math.max(0, next)));
  }

  function finish() {
    markIntroSeen();
    onDone();
    router.push("/signup");
  }

  return (
    <main className="fixed inset-0 z-50 flex flex-col bg-[#f4f6f5] text-navy">
      <header className="flex items-center justify-between px-4 pt-4 md:px-10">
        <p className="text-sm font-semibold text-teal">billflow</p>
        {last ? (
          <span className="min-h-12" />
        ) : (
          <button type="button" className="min-h-12 px-3 text-sm font-semibold text-slate-500" onClick={finish}>
            Skip
          </button>
        )}
      </header>
      <div
        className="flex flex-1 flex-col px-6 pb-8 md:mx-auto md:w-full md:max-w-lg md:justify-center md:px-10"
        onTouchStart={(event) => {
          startX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (startX.current == null) return;
          const delta = (event.changedTouches[0]?.clientX ?? startX.current) - startX.current;
          if (delta < -48) go(index + 1);
          if (delta > 48) go(index - 1);
        }}
      >
        <div className="flex h-[42vh] items-end pb-6 md:h-auto md:items-center md:pb-0">
          <div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-navy text-emerald">
            <Icon size={48} aria-hidden />
          </div>
        </div>
        <h1 className="max-w-sm text-4xl font-bold leading-tight">{slide.title}</h1>
        <p className="mt-3 max-w-sm text-base leading-6 text-slate-600">{slide.body}</p>
        <div className="mt-6 flex gap-2" role="tablist" aria-label="Intro slides">
          {slides.map((item, dot) => (
            <button
              key={item.title}
              type="button"
              role="tab"
              aria-selected={dot === index}
              aria-label={`Slide ${dot + 1} of ${slides.length}`}
              className={`h-2.5 rounded-full ${dot === index ? "w-8 bg-navy" : "w-2.5 bg-navy/25"}`}
              onClick={() => go(dot)}
            />
          ))}
        </div>
        <div className="mt-8 flex gap-3">
          {index > 0 ? (
            <button type="button" className="min-h-12 rounded-full px-5 text-sm font-semibold text-navy" onClick={() => go(index - 1)}>
              Back
            </button>
          ) : null}
          {last ? (
            <button type="button" className="min-h-12 rounded-full bg-emerald px-6 text-sm font-semibold text-navy" onClick={finish}>
              Get started
            </button>
          ) : (
            <button type="button" className="min-h-12 flex-1 rounded-full bg-navy px-6 text-sm font-semibold text-white md:flex-none" onClick={() => go(index + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

export function FirstRun({ children }: { children: React.ReactNode }) {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    setSeen(localStorage.getItem(SEEN) === "1");
  }, []);
  if (seen === null) return null;
  if (!seen) {
    return <IntroSlides onDone={() => setSeen(true)} />;
  }
  return children;
}
