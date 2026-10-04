import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { SinglePlayback } from "@/components/single-playback";
import { LanguagePicker } from "@/components/language-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { getI18n } from "@/lib/i18n/server";
import { logout } from "../(auth)/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  const { m } = await getI18n();

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Logo />
          <NavLinks isAdmin={!!user.is_admin} className="ml-4 hidden sm:flex" />
          <div className="ml-auto flex items-center gap-2">
            <LanguagePicker />
            <ThemeToggle initial={theme} />
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface py-1 pl-1 pr-1 sm:pr-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-xs font-bold uppercase text-white">
                {user.username.slice(0, 1)}
              </span>
              <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{user.username}</span>
              <form action={logout}>
                <button
                  aria-label={m.nav.logOut}
                  title={m.nav.logOut}
                  className="grid h-7 w-7 place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-fg"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
                  </svg>
                </button>
              </form>
            </div>
          </div>
        </div>
        <NavLinks isAdmin={!!user.is_admin} className="mx-auto max-w-6xl px-3 pb-2 sm:hidden" />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">{children}</main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 pt-4 text-xs text-subtle">
        {m.nav.footer}
      </footer>
      <SinglePlayback />
    </div>
  );
}
