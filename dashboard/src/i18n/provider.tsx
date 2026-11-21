"use client";

import { NextIntlClientProvider } from "next-intl";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { messages, type Locale } from "./messages";

interface LocaleValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleValue>({ locale: "en", setLocale: () => undefined });

const STORAGE = "billflow-locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE);
    if (saved === "bn" || saved === "en") setLocaleState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "bn" ? "bn" : "en-IN";
    localStorage.setItem(STORAGE, locale);
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale: (next: Locale) => setLocaleState(next),
    }),
    [locale],
  );

  return (
    <LocaleContext.Provider value={value}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Kolkata">
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <div className={`inline-flex rounded-full border border-slate-300 bg-white p-1 text-sm font-semibold ${className}`} role="group" aria-label="Language">
      <button type="button" className={`rounded-full px-3 py-1 ${locale === "en" ? "bg-navy text-white" : "text-navy"}`} onClick={() => setLocale("en")}>
        EN
      </button>
      <button type="button" className={`rounded-full px-3 py-1 ${locale === "bn" ? "bg-navy text-white" : "text-navy"}`} onClick={() => setLocale("bn")}>
        বাং
      </button>
    </div>
  );
}
