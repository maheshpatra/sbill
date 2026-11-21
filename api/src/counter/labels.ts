export type Locale = 'en' | 'bn';

const LABELS: Record<Locale, Record<string, string>> = {
  en: {
    invoice: 'Invoice',
    total: 'Total',
    pay_upi: 'Pay with any UPI app',
    reminder: 'Invoice {{number}} for {{total}} is due. {{link}}',
    balance: 'Balance',
    thanks: 'Thank you',
  },
  bn: {
    invoice: 'চালান',
    total: 'মোট',
    pay_upi: 'যেকোনো UPI অ্যাপে পরিশোধ করুন',
    reminder: 'চালান {{number}}, মোট {{total}}। {{link}}',
    balance: 'বকেয়া',
    thanks: 'ধন্যবাদ',
  },
};

export function asLocale(value: string | null | undefined): Locale {
  return value === 'bn' ? 'bn' : 'en';
}

export function labels(locale: string | null | undefined) {
  return LABELS[asLocale(locale)];
}

export function label(locale: string | null | undefined, key: string) {
  return labels(locale)[key] ?? LABELS.en[key] ?? key;
}
