"use client";

import { createContext, useContext } from "react";
import type { Locale } from "./config";
import { MESSAGES, type Messages } from ".";

const I18nContext = createContext<Locale>("en");

/** Set once in the root layout; client components read the language with useI18n(). */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

export function useI18n(): { locale: Locale; m: Messages } {
  const locale = useContext(I18nContext);
  return { locale, m: MESSAGES[locale] };
}
