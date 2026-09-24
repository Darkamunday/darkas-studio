import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedTrack } from "@/lib/sharing";
import { appUrl } from "@/lib/url";
import { LogoMark } from "@/components/logo";
import { Player } from "@/components/player";
import { btnPrimary, card, tag } from "@/components/ui";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

export async function generateMetadata({ params }: PageProps<"/s/[token]">): Promise<Metadata> {
  const { token } = await params;
  const t = getSharedTrack(token);
  if (!t) return { title: "Song not found", robots: { index: false, follow: false } };

  const base = await appUrl();
  const title = t.title ?? "Untitled";
  const description = [`A song by ${t.username}`, t.genre, t.mood].filter(Boolean).join(" · ");
  const cover = t.image_path || t.source_image_url ? `${base}/api/share/${token}/cover` : undefined;

  return {
    title: `${title} — ${t.username}`,
    description,
    // Share links are unlisted: fine to pass around, but keep them out of search engines.
    robots: { index: false, follow: false },
    openGraph: {
      type: "music.song",
      title,
      description,
      url: `${base}/s/${token}`,
      siteName: "Darka's Studio",
      images: cover ? [{ url: cover, width: 1024, height: 1024, alt: title }] : undefined,
      audio: [{ url: `${base}/api/share/${token}`, type: "audio/mpeg" }],
    },
    twitter: { card: cover ? "summary_large_image" : "summary", title, description, images: cover ? [cover] : undefined },
  };
}

export default async function SharedSongPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const t = getSharedTrack(token);
  if (!t) notFound();

  const hasCover = Boolean(t.image_path || t.source_image_url);
  const userPrompt = t.mode === "advanced" ? t.style : t.prompt;

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:py-16">
      <article className={`${card} w-full max-w-xl overflow-hidden`}>
        <div className="relative aspect-square w-full bg-surface-2">
          {hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/share/${token}/cover`} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-brand opacity-60" />
          )}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {t.genre && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">{t.genre}</span>}
              {t.mood && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">{t.mood}</span>}
              {t.instrumental ? <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">Instrumental</span> : null}
            </div>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{t.title ?? "Untitled"}</h1>
            <p className="mt-1 text-white/85">
              by <span className="font-semibold">{t.username}</span> · {dateFmt.format(new Date(t.created_at * 1000))}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <Player src={`/api/share/${token}`} seed={t.id} duration={t.duration} />

          <a href={`/api/share/${token}?download=1`} className={`${btnPrimary} self-start`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
            </svg>
            Download MP3
          </a>

          {t.remix_of_username && (
            <p className="text-sm text-muted">
              Remix of <span className="font-medium text-fg">{t.remix_of_title ?? "Untitled"}</span> by{" "}
              <span className="font-medium text-fg">{t.remix_of_username}</span>
            </p>
          )}
          {userPrompt && <p className="text-sm text-muted">“{userPrompt}”</p>}

          {t.lyrics && (
            <details className="group/lyrics" open>
              <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 text-sm font-medium text-accent-fg [&::-webkit-details-marker]:hidden">
                <span className="transition group-open/lyrics:rotate-90">›</span>
                <span className="group-open/lyrics:hidden">Show lyrics</span>
                <span className="hidden group-open/lyrics:inline">Hide lyrics</span>
              </summary>
              <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-5 text-sm leading-relaxed">
                {t.lyrics.split("\n").map((line, i) =>
                  /^\s*\[.*\]\s*$/.test(line) ? (
                    <p key={i} className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-accent-fg first:mt-0">
                      {line.trim().slice(1, -1)}
                    </p>
                  ) : line.trim() ? (
                    <p key={i}>{line}</p>
                  ) : null,
                )}
              </div>
            </details>
          )}
        </div>
      </article>

      <p className="mt-8 flex items-center gap-2 text-sm text-subtle">
        <LogoMark className="h-6 w-6" />
        Made at <span className="font-display font-semibold text-muted">Darka&apos;s Studio</span>
        <span className={tag.plain}>invite only</span>
      </p>
    </main>
  );
}
