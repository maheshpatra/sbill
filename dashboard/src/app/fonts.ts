import { Baloo_Da_2, Hind_Siliguri, Tiro_Bangla } from "next/font/google";

/** UI text. Hind Siliguri keeps Bengali conjuncts clear at small sizes. */
export const hind = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hind",
  display: "swap",
});

/** Friendly headings, including the big New bill button. */
export const baloo = Baloo_Da_2({
  subsets: ["bengali", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-baloo",
  display: "swap",
});

/** Invoice titles. A serif so a bill reads apart from the app. */
export const tiro = Tiro_Bangla({
  subsets: ["bengali", "latin"],
  weight: "400",
  variable: "--font-tiro",
  display: "swap",
});
