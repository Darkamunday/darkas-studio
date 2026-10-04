import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { canRemix, getRemixSource } from "@/lib/remix";
import { DEFAULT_MODEL } from "@/lib/suno";
import { MOODS, canViewTrack, pendingGenerationsForUser, refreshStalePending } from "@/lib/tracks";
import { GenerateStudio, type RemixSourceInfo } from "./studio";
import { getI18n } from "@/lib/i18n/server";
import { fmt, rich } from "@/lib/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.create };
}

export default async function GeneratePage({ searchParams }: PageProps<"/generate">) {
  const user = await requireUser();
  const { m } = await getI18n();
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
    if (!src) remixError = m.generate.remixUnavailable;
    else if (!canRemix(user, src)) remixError = fmt(m.generate.remixOff, { name: src.username });
    else
      remix = {
        id: src.id,
        title: src.title ?? m.common.untitled,
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
          {rich(remix ? m.generate.headingRemix : m.generate.heading, {
            name: <span className="text-brand">{user.username}</span>,
          })}
        </h1>
        <p className="mt-3 text-muted">{remix ? m.generate.blurbRemix : m.generate.blurb}</p>
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
