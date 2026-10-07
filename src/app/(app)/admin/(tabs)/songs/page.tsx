import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { BIN_DAYS, listAdminRemoved, purgeExpiredBin } from "@/lib/bin";
import { timedLyricsCandidates } from "@/lib/timed-lyrics";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/format";
import { BinRow, DaysLeft } from "../../../catalogue/deleted/bin-row";
import { Badge } from "../../ui";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: `${m.meta.admin} · ${m.admin.tabSongs}` };
}

export default async function AdminSongsPage() {
  const me = await requireAdmin();
  const { locale, m } = await getI18n();
  const tag = LOCALE_INFO[locale].tag;
  const dateFmt = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "Europe/London" });
  const fmtDate = (s: number | null) => (s ? dateFmt.format(new Date(s * 1000)) : "—");

  await purgeExpiredBin();
  const removed = listAdminRemoved();
  const timedCandidates = timedLyricsCandidates(me.id);

  return (
    <div className="flex flex-col gap-8">
      {/* ---- timestamped lyrics ---- */}
      <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
        <h2 className="text-lg font-semibold">{m.timed.heading}</h2>
        <p className="mt-1 text-sm text-muted">{m.timed.adminBlurb}</p>
        {timedCandidates.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{m.timed.noTracks}</p>
        ) : (
          <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
            {timedCandidates.map((t) => (
              <li key={t.id} className="border-b border-line">
                <Link href={`/admin/lyrics/${t.id}`} className="flex items-center gap-2 py-2.5 text-sm transition hover:text-accent-fg">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{t.title ?? m.common.untitled}</span>{" "}
                    <span className="text-subtle">· {t.username} · {fmtDate(t.created_at)}</span>
                  </span>
                  {t.has_timings ? <Badge tone="violet">{m.timed.saved}</Badge> : null}
                  <span aria-hidden className="text-subtle">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- songs admins removed (not in their owners' bins) ---- */}
      {removed.length > 0 && (
        <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
          <h2 className="text-lg font-semibold">{m.bin.adminHeading}</h2>
          <p className="mt-1 text-sm text-muted">{fmt(m.bin.adminBlurb, { days: BIN_DAYS })}</p>
          <ul className="-mx-4 mt-2 divide-y divide-line">
            {removed.map((t) => (
              <BinRow key={t.id} track={t} title={t.title ?? m.common.untitled}>
                {fmt(m.bin.adminRow, { owner: t.username, by: t.deleted_by_name ?? "?", date: fmtDate(t.deleted_at) })} ·{" "}
                <DaysLeft days={t.days_left} />
              </BinRow>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
