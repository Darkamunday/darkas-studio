import type { BinnedTrack } from "@/lib/bin";
import { plural } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { BinButton } from "./bin-buttons";
import { coverVersion } from "@/lib/cover-url";

/** One binned track: thumbnail, title, a details line, and Restore. Shared with the admin page. */
export function BinRow({ track: t, title, children }: { track: BinnedTrack; title: string; children: React.ReactNode }) {
  const hasCover = Boolean(t.image_path || t.source_image_url);
  return (
    <li className="flex items-center gap-4 p-4">
      {hasCover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/bin/${t.id}/cover${coverVersion(t.image_path)}`} alt="" loading="lazy" className="h-14 w-14 flex-none rounded-xl object-cover opacity-80" />
      ) : (
        <div className="h-14 w-14 flex-none rounded-xl bg-brand opacity-30" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="text-xs text-subtle">{children}</p>
      </div>
      <BinButton id={t.id} kind="restore" />
    </li>
  );
}

export async function DaysLeft({ days }: { days: number }) {
  const { locale, m } = await getI18n();
  return days <= 1 ? <span className="text-warn">{m.bin.lastDay}</span> : <span>{plural(locale, m.bin.daysLeft, days)}</span>;
}
