import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { appUrl } from "@/lib/url";
import { canRemix } from "@/lib/remix";
import { canDeleteTrack, catalogueFacets, listCatalogue, pendingGenerationsVisibleTo, refreshStalePending } from "@/lib/tracks";
import { Equalizer } from "@/components/equalizer";
import { btnPrimary, card } from "@/components/ui";
import { FilterBar } from "./filter-bar";
import { PendingRefresher } from "./pending-refresher";
import { TrackCard } from "./track-card";
import { getI18n } from "@/lib/i18n/server";
import { fmt, plural, rich } from "@/lib/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.catalogue };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function CataloguePage({ searchParams }: PageProps<"/catalogue">) {
  const user = await requireUser();
  const { locale, m } = await getI18n();
  const sp = await searchParams;
  const filters = { genre: one(sp.genre), creator: one(sp.creator) };

  refreshStalePending();
  const tracks = listCatalogue(user.id, filters);
  const facets = catalogueFacets(user.id);
  const pending = pendingGenerationsVisibleTo(user.id);
  const filtered = Boolean(filters.genre || filters.creator);
  const base = await appUrl();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-semibold sm:text-5xl">{m.catalogue.heading}</h1>
          <p className="mt-3 text-muted">
            {filtered
              ? plural(locale, m.catalogue.matching, tracks.length)
              : tracks.length
                ? fmt(m.catalogue.summary, {
                    tracks: plural(locale, m.catalogue.tracks, tracks.length),
                    artists: plural(locale, m.catalogue.artists, facets.creators.length),
                  })
                : m.catalogue.emptyBlurb}
          </p>
        </div>
        {(tracks.length > 0 || filtered) && <FilterBar genres={facets.genres} creators={facets.creators} current={filters} />}
      </div>

      {pending.length > 0 && !filtered && (
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {pending.map((g) => (
            <div key={g.id} className={`${card} overflow-hidden`}>
              <div className="skeleton relative grid aspect-[5/4] place-items-center">
                <Equalizer className="h-10" bars={5} />
              </div>
              <div className="flex flex-col gap-2 p-5">
                <p className="line-clamp-2 font-medium">{g.prompt ?? g.title ?? g.style}</p>
                <p className="text-sm text-subtle">
                  {rich(m.catalogue.cooking, { name: <span className="font-medium text-muted">{g.username}</span> })}
                </p>
              </div>
            </div>
          ))}
          <PendingRefresher />
        </section>
      )}

      {tracks.length === 0 ? (
        <div className={`${card} flex flex-col items-center px-6 py-16 text-center`}>
          <Equalizer className="h-12" bars={5} still />
          <h2 className="mt-6 text-2xl font-semibold">{filtered ? m.catalogue.noMatchHeading : m.catalogue.emptyHeading}</h2>
          <p className="mt-2 max-w-sm text-muted">{filtered ? m.catalogue.noMatchText : m.catalogue.emptyText}</p>
          <Link href={filtered ? "/catalogue" : "/generate"} className={`${btnPrimary} mt-6`}>
            {filtered ? m.catalogue.clearFilters : m.catalogue.makeFirst}
          </Link>
        </div>
      ) : (
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tracks.map((t) => (
            <TrackCard
              key={t.id}
              track={t}
              canDelete={canDeleteTrack(user, t.owner_id)}
              isOwner={t.owner_id === user.id}
              shareUrl={t.share_token ? `${base}/s/${t.share_token}` : null}
              canRemix={canRemix(user, t)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
