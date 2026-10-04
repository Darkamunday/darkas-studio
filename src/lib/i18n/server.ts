import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, isLocale, matchAcceptLanguage, type Locale } from "./config";
import { MESSAGES, type Messages } from ".";

/** The visitor's language: their saved choice, else their browser's, else English. Once per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return matchAcceptLanguage((await headers()).get("accept-language"));
});

/** Works in Server Components, Server Actions and Route Handlers. */
export async function getI18n(): Promise<{ locale: Locale; m: Messages }> {
  const locale = await getLocale();
  return { locale, m: MESSAGES[locale] };
}
