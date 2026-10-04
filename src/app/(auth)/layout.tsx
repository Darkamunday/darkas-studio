import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Equalizer } from "@/components/equalizer";
import { LanguagePicker } from "@/components/language-picker";
import { LogoMark } from "@/components/logo";
import { getI18n } from "@/lib/i18n/server";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getCurrentUser()) redirect("/");
  const { m } = await getI18n();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[2rem] border border-line bg-surface shadow-card md:grid-cols-2">
        {/* Brand panel */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-brand p-10 text-white md:flex">
          <div aria-hidden className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-white/15 blur-2xl" />
          <div className="flex items-center gap-2.5 font-display text-lg font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 backdrop-blur">
              <Equalizer className="h-4" still barClassName="bg-white" />
            </span>
            Darka&apos;s Studio
          </div>
          <div className="relative">
            <p className="font-display text-4xl font-semibold leading-tight">
              {m.auth.taglineTop}
              <br />
              {m.auth.taglineBottom}
            </p>
            <p className="mt-4 max-w-xs text-white/85">{m.auth.blurb}</p>
          </div>
          <div className="flex h-10 items-end gap-1.5" aria-hidden>
            {[0.4, 0.8, 0.55, 1, 0.7, 0.45, 0.9, 0.6, 0.35, 0.75, 0.5, 0.95, 0.65, 0.4].map((h, i) => (
              <span
                key={i}
                className="w-1.5 origin-bottom animate-eq rounded-full bg-white/70"
                style={{ height: `${h * 100}%`, animationDelay: `${(i * 137) % 900}ms`, animationDuration: `${1 + (i % 4) * 0.25}s` }}
              />
            ))}
          </div>
        </div>

        {/* Form panel */}
        <div className="p-8 sm:p-10">
          <div className="mb-8 flex items-center gap-2.5">
            <div className="flex items-center gap-2.5 font-display text-lg font-semibold md:hidden">
              <LogoMark />
              Darka&apos;s <span className="text-brand">Studio</span>
            </div>
            <LanguagePicker className="ml-auto" />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
