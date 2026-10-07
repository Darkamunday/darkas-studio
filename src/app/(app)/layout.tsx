import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { SinglePlayback } from "@/components/single-playback";
import { getI18n } from "@/lib/i18n/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const { m } = await getI18n();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">{children}</main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 pt-4 text-xs text-subtle">
        {m.nav.footer}
      </footer>
      <SinglePlayback />
    </div>
  );
}
