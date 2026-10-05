import "server-only";
import type { GenerationRow, TrackRow } from "./tracks";
import { coverVersion } from "./cover-url";

export type ClientTrack = {
  id: number;
  title: string | null;
  genre: string | null;
  mood: string | null;
  duration: number | null;
  audioUrl: string | null;
  coverUrl: string | null;
};

export type ClientGeneration = {
  id: number;
  status: GenerationRow["status"];
  error: string | null;
  prompt: string | null;
  createdAt: number;
  tracks: ClientTrack[];
};

export function toClientTrack(t: TrackRow): ClientTrack {
  const hasAudio = t.audio_path || t.source_audio_url;
  return {
    id: t.id,
    title: t.title,
    genre: t.genre,
    mood: t.mood,
    duration: t.duration,
    // Until the final file exists, play Suno's live stream directly.
    audioUrl: hasAudio ? `/api/media/${t.id}` : t.source_stream_url,
    coverUrl: t.image_path || t.source_image_url ? `/api/media/${t.id}/cover${coverVersion(t.image_path)}` : null,
  };
}

export function toClientGeneration(g: GenerationRow, tracks: TrackRow[]): ClientGeneration {
  return {
    id: g.id,
    status: g.status,
    error: g.error,
    prompt: g.prompt ?? g.title ?? g.style,
    createdAt: g.created_at,
    tracks: tracks.map(toClientTrack),
  };
}
