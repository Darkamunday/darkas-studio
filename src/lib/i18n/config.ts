// Shared by server and client: which languages exist and how to name them.

export const LOCALES = ["en", "fr", "id", "pt", "ms"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Remembered choice; read by the server on every request, set by the language picker. */
export const LOCALE_COOKIE = "lang";

export const LOCALE_INFO: Record<Locale, { name: string; short: string; tag: string }> = {
  // `tag` is the BCP 47 tag for <html lang> and Intl date/number formatting.
  en: { name: "English", short: "EN", tag: "en-GB" },
  fr: { name: "Français", short: "FR", tag: "fr-FR" },
  id: { name: "Bahasa Indonesia", short: "ID", tag: "id-ID" },
  pt: { name: "Português (Brasil)", short: "PT", tag: "pt-BR" },
  ms: { name: "Bahasa Melayu", short: "MS", tag: "ms-MY" },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Best supported language from an Accept-Language header, e.g. "pt-BR,pt;q=0.9,en;q=0.8" → "pt". */
export function matchAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) {
    const l = lang === "in" ? "id" : lang; // "in" is the old code for Indonesian
    if (isLocale(l)) return l;
  }
  return DEFAULT_LOCALE;
}
