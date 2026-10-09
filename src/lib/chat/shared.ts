import "server-only";
import { db } from "../db";
import { getProject } from "./projects";

// A project's Shared tab: images (and other media) made in its chats, and songs made from its chats
// with "Make it a song". Everyone who can use the project sees them, while the person who made each
// one can still use the project. The maker or the project's owner can take one off the tab. Private
// songs stay private, and a deleted chat or song takes its items with it.

export type SharedItem =
  | {
      kind: "media";
      id: number;
      media: "image" | "video" | "audio";
      prompt: string;
      url: string;
      by: string;
      at: number;
      canRemove: boolean;
    }
  | {
      kind: "song";
      /** The generation: one song, usually two takes. */
      id: number;
      title: string | null;
      style: string | null;
      takes: { id: number; title: string | null; duration: number | null; audioUrl: string; coverUrl: string | null }[];
      by: string;
      at: number;
      canRemove: boolean;
    };

/** Whether the maker of something in project `p` can still use it. SQL over `x.user_id` and projects `p`. */
const MAKER_IN = `(x.user_id = p.user_id OR p.everyone = 1
  OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = x.user_id))`;

/** What's on a project's Shared tab, newest first. Undefined if this person can't use the project. */
export function listShared(userId: number, projectId: number): SharedItem[] | undefined {
  const project = getProject(userId, projectId);
  if (!project) return undefined;
  const isOwner = project.user_id === userId;

  const media = (
    db
      .prepare(
        `SELECT x.id, x.user_id, x.kind, x.prompt, x.created_at, u.username
           FROM chat_images x JOIN projects p ON p.id = x.project_id JOIN users u ON u.id = x.user_id
          WHERE x.project_id = ? AND x.status = 'ready' AND x.project_hidden = 0 AND ${MAKER_IN}`,
      )
      .all(projectId) as { id: number; user_id: number; kind: "image" | "video" | "audio"; prompt: string; created_at: number; username: string }[]
  ).map(
    (r): SharedItem => ({
      kind: "media",
      id: r.id,
      media: r.kind ?? "image",
      prompt: r.prompt,
      url: `/api/chat/images/${r.id}/file`,
      by: r.username,
      at: r.created_at,
      canRemove: isOwner || r.user_id === userId,
    }),
  );

  const rows = db
    .prepare(
      `SELECT x.id, x.user_id, x.title AS song_title, x.style, x.created_at, u.username,
              t.id AS track_id, t.title, t.duration, (t.image_path IS NOT NULL OR t.source_image_url IS NOT NULL) AS has_cover
         FROM generations x JOIN projects p ON p.id = x.project_id JOIN users u ON u.id = x.user_id
         JOIN tracks t ON t.generation_id = x.id
        WHERE x.project_id = ? AND x.status = 'complete' AND x.project_hidden = 0 AND t.is_private = 0 AND ${MAKER_IN}
        ORDER BY t.id`,
    )
    .all(projectId) as {
    id: number;
    user_id: number;
    song_title: string | null;
    style: string | null;
    created_at: number;
    username: string;
    track_id: number;
    title: string | null;
    duration: number | null;
    has_cover: number;
  }[];
  const songs = new Map<number, Extract<SharedItem, { kind: "song" }>>();
  for (const r of rows) {
    let song = songs.get(r.id);
    if (!song) {
      song = { kind: "song", id: r.id, title: r.song_title, style: r.style, takes: [], by: r.username, at: r.created_at, canRemove: isOwner || r.user_id === userId };
      songs.set(r.id, song);
    }
    song.takes.push({
      id: r.track_id,
      title: r.title,
      duration: r.duration,
      audioUrl: `/api/media/${r.track_id}`,
      coverUrl: r.has_cover ? `/api/media/${r.track_id}/cover` : null,
    });
  }

  return [...media, ...songs.values()].sort((a, b) => b.at - a.at || b.id - a.id);
}

/** Whether this person may see an image because it's on a Shared tab they can see. */
export function canSeeSharedImage(userId: number, image: { project_id: number | null; project_hidden: number; user_id: number }): boolean {
  if (!image.project_id || image.project_hidden || !getProject(userId, image.project_id)) return false;
  return !!db.prepare(`SELECT 1 FROM projects p, (SELECT ? AS user_id) x WHERE p.id = ? AND ${MAKER_IN}`).get(image.user_id, image.project_id);
}

/** Take something off a project's Shared tab: its maker or the project's owner. False if not allowed. */
export function hideShared(userId: number, projectId: number, kind: "media" | "song", id: number): boolean {
  const table = kind === "media" ? "chat_images" : "generations";
  return (
    db
      .prepare(
        `UPDATE ${table} SET project_hidden = 1
          WHERE id = ? AND project_id = ?
            AND (user_id = ? OR (SELECT user_id FROM projects WHERE id = ?) = ?)`,
      )
      .run(id, projectId, userId, projectId, userId).changes > 0
  );
}

/** The project of the chat a reply of this person's is in, if they can still use it ("Make it a song"). */
export function projectOfReply(userId: number, messageId: number): number | null {
  if (!Number.isInteger(messageId) || messageId <= 0) return null;
  const row = db
    .prepare(
      `SELECT c.project_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = ? AND c.user_id = ? AND m.role = 'assistant'`,
    )
    .get(messageId, userId) as { project_id: number | null } | undefined;
  return row?.project_id && getProject(userId, row.project_id) ? row.project_id : null;
}
