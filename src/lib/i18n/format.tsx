// Shared by server and client: fill in translated templates.
import { Fragment, type ReactNode } from "react";
import { LOCALE_INFO, type Locale } from "./config";

type Vars = Record<string, string | number>;

/** "{n} songs" + { n: 3 } → "3 songs". Unknown placeholders are left as they are. */
export function fmt(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole));
}

/** Like fmt, but placeholders can be elements, e.g. a bold username inside a sentence. */
export function rich(template: string, vars: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return <Fragment key={i}>{m && m[1] in vars ? vars[m[1]] : part}</Fragment>;
  });
}

export type Plural = { one: string; other: string };

/** Pick the plural form for n using the language's own rules (French says "1 morceau", "0 morceau"). */
export function plural(locale: Locale, forms: Plural, n: number, vars: Vars = {}): string {
  const rule = new Intl.PluralRules(LOCALE_INFO[locale].tag).select(n);
  return fmt(rule === "one" ? forms.one : forms.other, { n, ...vars });
}

/** Translate a stored code (e.g. a mood or error code), falling back to the raw value for older data. */
export function lookup(map: Record<string, string>, key: string | null | undefined): string | null {
  if (!key) return null;
  return Object.hasOwn(map, key) ? map[key] : key;
}
