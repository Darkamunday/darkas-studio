import Link from "next/link";
import type { CatalogueTrack } from "@/lib/tracks";
import { Player } from "@/components/player";
import { BIN_DAYS } from "@/lib/bin";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt, lookup, rich } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { btnSecondary, card, tag } from "@/components/ui";
import { DeleteTrackButton } from "./delete-button";
import { PrivateToggle } from "./private-toggle";
import { RemixToggle } from "./remix-toggle";
import { CoverChanger } from "./cover-changer";
import { coversEnabled } from "@/lib/comfy";
import { ShareButton } from "./share-button";
import { coverVersion } from "@/lib/cover-url";

export async function TrackCard({
  track: t,
  canDelete,
  isOwner,
  shareUrl,
  canRemix,
  isAdmin,
}: {
  track: CatalogueTrack;
  canDelete: boolean;
  /** Only the creator gets sharing controls (admins can't share others' songs). */
  isOwner: boolean;
  shareUrl: string | null;
  /** Remixing allowed for this viewer (creator switched it on, or it's their own song). */
  canRemix: boolean;
  /** Admins get a link to the timestamped-lyrics tool. */
  isAdmin: boolean;
}) {
  const { locale, m } = await getI18n();
  const dateFmt = new Intl.DateTimeFormat(LOCALE_INFO[locale].tag, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  const hasCover = Boolean(t.image_path || t.source_image_url);
  // Simple mode: the user's description; advanced mode: their style box. Suno's expanded tags shown separately.
  const userPrompt = t.mode === "advanced" ? t.style : t.prompt;

  return (
    <article className={`${card} group flex flex-col overflow-hidden transition duration-300 hover:-translate-y-0.5 hover:border-line-strong`}>
      <div className="relative aspect-[5/4] w-full overflow-hidden bg-surface-2">
        {hasCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media/${t.id}/cover${coverVersion(t.image_path)}`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full bg-brand opacity-50" />
        )}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
          {t.genre && (
            <Link href={`/catalogue?genre=${encodeURIComponent(t.genre)}`} className="rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur hover:bg-black/60">
              {t.genre}
            </Link>
          )}
          {t.mood && <span className="rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur">{lookup(m.moods, t.mood)}</span>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h2 className="text-lg font-semibold leading-snug">{t.title ?? m.common.untitled}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-subtle">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-brand text-[10px] font-bold uppercase text-white">
              {t.username.slice(0, 1)}
            </span>
            <Link href={`/catalogue?creator=${encodeURIComponent(t.username)}`} className="font-medium text-muted hover:text-fg">
              {t.username}
            </Link>
            · {dateFmt.format(new Date(t.created_at * 1000))}
            <span className="ml-auto flex gap-1">
              {t.is_private ? <span className={tag.mood}>{m.common.private}</span> : null}
              {t.share_token && !isOwner ? <span className={tag.plain}>{m.catalogue.sharedPublicly}</span> : null}
              {t.instrumental ? <span className={tag.plain}>{m.common.instrumental}</span> : null}
            </span>
          </p>
        </div>

        {t.remix_of_username && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <RemixIcon />
            <span>
              {rich(m.common.remixOf, {
                title: <span className="font-medium text-fg">{t.remix_of_title ?? m.common.untitled}</span>,
                user: <span className="font-medium text-fg">{t.remix_of_username}</span>,
              })}
            </span>
          </p>
        )}

        {userPrompt && <p className="line-clamp-3 text-sm text-muted">“{userPrompt}”</p>}
        {t.style_tags && t.style_tags !== userPrompt && (
          <p className="line-clamp-2 text-xs text-subtle" title={t.style_tags}>
            <span className="font-medium text-muted">{m.catalogue.style}</span> · {t.style_tags}
          </p>
        )}

        {t.lyrics && (
          <details className="group/lyrics">
            <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 text-sm font-medium text-accent-fg [&::-webkit-details-marker]:hidden">
              <span className="transition group-open/lyrics:rotate-90">›</span>
              <span className="group-open/lyrics:hidden">{m.common.showLyrics}</span>
              <span className="hidden group-open/lyrics:inline">{m.common.hideLyrics}</span>
            </summary>
            <Lyrics text={t.lyrics} />
          </details>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-2">
          <Player src={`/api/media/${t.id}`} seed={t.id} duration={t.duration} />
          <div className="flex flex-wrap items-center gap-2">
            {canRemix && (
              <Link href={`/generate?remix=${t.id}`} className={btnSecondary}>
                <RemixIcon /> {m.catalogue.remix}
              </Link>
            )}
            <a href={`/api/media/${t.id}?download=1`} className={btnSecondary}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
              </svg>
              {m.common.download}
            </a>
            {isAdmin && t.lyrics && !t.instrumental && (
              <Link href={`/admin/lyrics/${t.id}`} className={btnSecondary}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                {m.timed.open}
              </Link>
            )}
            {isOwner && coversEnabled() && (
              <CoverChanger
                trackId={t.id}
                suggestion={fmt(m.covers.suggestion, { title: t.title ?? m.common.untitled, style: t.style_tags ?? t.genre ?? "" })
                  .replace(/[:：]\s*$/, "")
                  .slice(0, 600)}
              />
            )}
            {isOwner && <ShareButton trackId={t.id} initialUrl={shareUrl} />}
            {canDelete && (
              <DeleteTrackButton trackId={t.id} title={t.title ?? m.common.untitled} ownerName={t.username} isOwner={isOwner} binDays={BIN_DAYS} />
            )}
            {isOwner && <PrivateToggle trackId={t.id} initial={t.is_private === 1} />}
            {isOwner && <RemixToggle trackId={t.id} initial={t.allow_remix === 1} />}
          </div>
        </div>
      </div>
    </article>
  );
}

function RemixIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
    </svg>
  );
}

function Lyrics({ text }: { text: string }) {
  return (
    <div className="mt-3 max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface-2 p-4 text-sm leading-relaxed">
      {text.split("\n").map((line, i) =>
        /^\s*\[.*\]\s*$/.test(line) ? (
          <p key={i} className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-accent-fg first:mt-0">
            {line.trim().slice(1, -1)}
          </p>
        ) : line.trim() ? (
          <p key={i}>{line}</p>
        ) : null,
      )}
    </div>
  );
}
