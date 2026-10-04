"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES, LOCALE_COOKIE, LOCALE_INFO, type Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

/**
 * Globe button showing the current language code. A transparent native <select> sits on top,
 * so the menu, keyboard and screen-reader behaviour are the browser's own.
 */
export function LanguagePicker({ className = "" }: { className?: string }) {
  const { locale, m } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <label
      title={m.nav.language}
      className={`relative flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-xs font-semibold text-muted transition hover:border-line-strong hover:text-fg focus-within:ring-2 focus-within:ring-pink ${
        pending ? "opacity-60" : ""
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      {LOCALE_INFO[locale].short}
      <select
        aria-label={m.nav.language}
        value={locale}
        onChange={(e) => change(e.target.value as Locale)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={LOCALE_INFO[l].tag}>
            {LOCALE_INFO[l].name}
          </option>
        ))}
      </select>
    </label>
  );
}
