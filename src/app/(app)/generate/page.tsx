import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { canRemix, getRemixSource } from "@/lib/remix";
import { DEFAULT_MODEL } from "@/lib/suno";
import { MOODS, canViewTrack, pendingGenerationsForUser, refreshStalePending } from "@/lib/tracks";
import { GenerateStudio, type RemixSourceInfo } from "./studio";

export const metadata: Metadata = { title: "Create" };

export default async function GeneratePage({ searchParams }: PageProps<"/generate">) {
  const user = await requireUser();
  refreshStalePending();
  const pending = pendingGenerationsForUser(user.id).map((g) => g.id);

  // ?remix=<trackId> opens the remix form for that song.
  const raw = (await searchParams).remix;
  const remixId = Number(Array.isArray(raw) ? raw[0] : raw);
  let remix: RemixSourceInfo | null = null;
  let remixError: string | null = null;
  if (remixId) {
    const found = getRemixSource(remixId);
    const src = found && canViewTrack(user.id, found) ? found : undefined;
    if (!src) remixError = "That song isn't available to remix any more.";
    else if (!canRemix(user, src)) remixError = `${src.username} has turned off remixes for that song.`;
    else
      remix = {
        id: src.id,
        title: src.title ?? "Untitled",
        username: src.username,
        lyrics: src.lyrics,
        style: src.style_tags,
        instrumental: src.instrumental === 1,
        coverUrl: src.has_cover ? `/api/media/${src.id}/cover` : null,
      };
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-4xl font-semibold sm:text-5xl">
          {remix ? (
            <>
              Let&apos;s flip it, <span className="text-brand">{user.username}</span>
            </>
          ) : (
            <>
              What are we making, <span className="text-brand">{user.username}</span>?
            </>
          )}
        </h1>
        <p className="mt-3 text-muted">
          {remix
            ? "Same melody, brand-new outfit. Pick a style and we'll re-record it — two takes, as always."
            : "Every song comes in two takes — keep your favourite, or keep both. We won't judge."}
        </p>
      </div>
      {remixError && (
        <p role="alert" className="rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn">
          {remixError}
        </p>
      )}
      <GenerateStudio moods={[...MOODS]} defaultModel={DEFAULT_MODEL} initialPending={pending} remix={remix} />
    </div>
  );
}
