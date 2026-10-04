import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { BIN_DAYS, listLostSongs, listOwnBin, purgeExpiredBin } from "@/lib/bin";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt, plural } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { Equalizer } from "@/components/equalizer";
import { card } from "@/components/ui";
import { BinButton } from "./bin-buttons";
import { BinRow, DaysLeft } from "./bin-row";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.bin };
}

export default async function RecentlyDeletedPage() {
  const user = await requireUser();
  const { locale, m } = await getI18n();
  await purgeExpiredBin();
  const binned = listOwnBin(user.id);
  const lost = listLostSongs(user.id);
  const dateFmt = new Intl.DateTimeFormat(LOCALE_INFO[locale].tag, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  const date = (s: number) => dateFmt.format(new Date(s * 1000));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <Link href="/catalogue" className="text-sm text-subtle transition hover:text-fg">
          {m.bin.back}
        </Link>
        <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">{m.bin.heading}</h1>
        <p className="mt-3 text-muted">{fmt(m.bin.blurb, { days: BIN_DAYS })}</p>
      </div>

      {binned.length === 0 && lost.length === 0 && (
        <div className={`${card} flex flex-col items-center px-6 py-14 text-center`}>
          <Equalizer className="h-10" bars={5} still />
          <p className="mt-5 max-w-sm text-muted">{fmt(m.bin.empty, { days: BIN_DAYS })}</p>
        </div>
      )}

      {binned.length > 0 && (
        <ul className={`${card} divide-y divide-line`}>
          {binned.map((t) => (
            <BinRow key={t.id} track={t} title={t.title ?? m.common.untitled}>
              {fmt(m.bin.deletedOn, { date: date(t.deleted_at) })} · <DaysLeft days={t.days_left} />
            </BinRow>
          ))}
        </ul>
      )}

      {lost.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">{m.bin.lostHeading}</h2>
            <p className="mt-1 text-sm text-muted">{m.bin.lostBlurb}</p>
          </div>
          <ul className={`${card} divide-y divide-line`}>
            {lost.map((g) => (
              <li key={g.id} className="flex items-center gap-4 p-4">
                <div className="h-14 w-14 flex-none rounded-xl bg-brand opacity-30" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.title ?? g.prompt ?? g.style ?? m.common.untitled}</p>
                  <p className="text-xs text-subtle">
                    {fmt(m.bin.madeOn, { date: date(g.created_at) })} · {plural(locale, m.bin.lostTakes, Math.max(1, g.missing))}
                  </p>
                </div>
                <BinButton id={g.id} kind="lost" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
