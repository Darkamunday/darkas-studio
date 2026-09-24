import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { appUrl } from "@/lib/url";
import { canRemix } from "@/lib/remix";
import { canDeleteTrack, catalogueFacets, listCatalogue, pendingGenerationsAll, refreshStalePending } from "@/lib/tracks";
import { Equalizer } from "@/components/equalizer";
import { btnPrimary, card } from "@/components/ui";
import { FilterBar } from "./filter-bar";
import { PendingRefresher } from "./pending-refresher";
import { TrackCard } from "./track-card";

export const metadata: Metadata = { title: "Catalogue" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function CataloguePage({ searchParams }: PageProps<"/catalogue">) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = { genre: one(sp.genre), creator: one(sp.creator) };

  refreshStalePending();
  const tracks = listCatalogue(filters);
  const facets = catalogueFacets();
  const pending = pendingGenerationsAll();
  const filtered = Boolean(filters.genre || filters.creator);
  const base = await appUrl();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-semibold sm:text-5xl">The catalogue</h1>
          <p className="mt-3 text-muted">
            {filtered ? (
              <>
                {tracks.length} {tracks.length === 1 ? "track" : "tracks"} matching
              </>
            ) : tracks.length ? (
              <>
                {tracks.length} {tracks.length === 1 ? "track" : "tracks"} from {facets.creators.length}{" "}
                {facets.creators.length === 1 ? "artist" : "artists"}. Press play on something.
              </>
            ) : (
              "Everything the crew makes lands here."
            )}
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
                  <span className="font-medium text-muted">{g.username}</span> is cooking something up…
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
          <h2 className="mt-6 text-2xl font-semibold">{filtered ? "Nothing matches that" : "The jukebox is hungry"}</h2>
          <p className="mt-2 max-w-sm text-muted">
            {filtered
              ? "Try a different genre or creator — or clear the filters and browse everything."
              : "No songs yet. Be the legend who makes the first one."}
          </p>
          <Link href={filtered ? "/catalogue" : "/generate"} className={`${btnPrimary} mt-6`}>
            {filtered ? "Clear filters" : "Make the first song"}
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
