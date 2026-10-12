import "server-only";
import path from "node:path";
import { copyFile, link, mkdir } from "node:fs/promises";
import { db, transaction } from "./db";
import { MEDIA_DIR, removeMediaFile, resolveMediaPath } from "./storage";
import { ownRow, usableRow } from "./albums";

// Picture albums: pictures and video made in chat, kept in albums (see albums.ts for sharing). Anyone in
// an album can add things they made in their chats and remove what they added; the owner can remove
// anything and reorder. Each album keeps its own copy of the file (a hard link where the disk allows),
// so deleting the chat it came from doesn't take it out of the album. Pictures from adult (18+) chats can
// only go in private albums, and are only ever shown to the person who added them (even if the album is
// shared later).

export const MAX_PICTURES_PER_ALBUM = 500;
const PICTURE_DIR = path.join(MEDIA_DIR, "album-pictures");

/** A picture (or video) in an album, as this person sees it. Shared by server and client code. */
export type AlbumPicture = {
  id: number;
  kind: "image" | "video";
  url: string;
  /** What it was made from. */
  prompt: string;
  addedBy: string | null;
  addedAt: number;
  /** This person may take it out (the owner, or whoever added it). */
  canRemove: boolean;
};

type Row = { id: number; kind: "image" | "video"; prompt: string; added_by: number | null; added_by_name: string | null; added_at: number };

/** The pictures in an album this person can open, in order. Undefined if they can't. */
export function albumPictures(userId: number, albumId: number): AlbumPicture[] | undefined {
  const album = usableRow(userId, albumId);
  if (album?.kind !== "pictures") return undefined;
  return (
    db
      .prepare(
        `SELECT p.id, p.kind, p.prompt, p.added_by, u.username AS added_by_name, p.added_at
           FROM album_pictures p LEFT JOIN users u ON u.id = p.added_by
          WHERE p.album_id = ? AND (p.adult = 0 OR p.added_by = ?) ORDER BY p.position, p.id`,
      )
      .all(albumId, userId) as Row[]
  ).map((r) => ({
    id: r.id,
    kind: r.kind,
    url: `/api/albums/pictures/${r.id}`,
    prompt: r.prompt,
    addedBy: r.added_by_name,
    addedAt: r.added_at,
    canRemove: album.user_id === userId || r.added_by === userId,
  }));
}

/** A picture's file, if this person can open its album. */
export function pictureFile(userId: number, pictureId: number): { file_path: string; prompt: string } | undefined {
  const row = db.prepare("SELECT album_id, file_path, prompt, adult, added_by FROM album_pictures WHERE id = ?").get(pictureId) as
    | { album_id: number; file_path: string; prompt: string; adult: number; added_by: number | null }
    | undefined;
  if (!row || (row.adult && row.added_by !== userId)) return undefined;
  return usableRow(userId, row.album_id) ? { file_path: row.file_path, prompt: row.prompt } : undefined;
}

export type AddPictureResult = "added" | "already" | "not_found" | "full";

/** Put one of this person's chat pictures or videos into a picture album they can open (at the end). */
export async function addPicture(userId: number, albumId: number, imageId: number): Promise<AddPictureResult> {
  const album = usableRow(userId, albumId);
  if (album?.kind !== "pictures") return "not_found";
  const image = db
    .prepare(
      `SELECT i.id, i.kind, i.prompt, i.file_path, c.adult FROM chat_images i JOIN conversations c ON c.id = i.conversation_id
        WHERE i.id = ? AND i.user_id = ? AND i.status = 'ready' AND i.kind IN ('image', 'video')`,
    )
    .get(imageId, userId) as { id: number; kind: "image" | "video"; prompt: string; file_path: string | null; adult: number } | undefined;
  if (!image?.file_path) return "not_found";
  // Adult pictures only go in your own private albums.
  if (image.adult && (album.user_id !== userId || album.everyone || db.prepare("SELECT 1 FROM album_members WHERE album_id = ?").get(albumId))) {
    return "not_found";
  }
  if (db.prepare("SELECT 1 FROM album_pictures WHERE album_id = ? AND source_image_id = ?").get(albumId, imageId)) return "already";
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM album_pictures WHERE album_id = ?").get(albumId) as { n: number };
  if (n >= MAX_PICTURES_PER_ALBUM) return "full";

  // The album's own copy of the file.
  await mkdir(PICTURE_DIR, { recursive: true });
  const ext = path.extname(image.file_path) || (image.kind === "video" ? ".mp4" : ".png");
  const id = Number(
    db
      .prepare(
        `INSERT INTO album_pictures (album_id, added_by, source_image_id, kind, prompt, file_path, position, adult)
         VALUES (?, ?, ?, ?, ?, '', (SELECT COALESCE(MAX(position), 0) + 1 FROM album_pictures WHERE album_id = ?), ?)`,
      )
      .run(albumId, userId, imageId, image.kind, image.prompt, albumId, image.adult).lastInsertRowid,
  );
  const rel = path.relative(MEDIA_DIR, path.join(PICTURE_DIR, `${id}${ext}`));
  try {
    await link(resolveMediaPath(image.file_path), resolveMediaPath(rel)).catch(() => copyFile(resolveMediaPath(image.file_path!), resolveMediaPath(rel)));
  } catch (err) {
    db.prepare("DELETE FROM album_pictures WHERE id = ?").run(id);
    console.error("[albums] couldn't copy a picture", err);
    return "not_found";
  }
  db.prepare("UPDATE album_pictures SET file_path = ? WHERE id = ?").run(rel, id);
  db.prepare("UPDATE albums SET updated_at = unixepoch() WHERE id = ?").run(albumId);
  return "added";
}

/** Take a picture out (the owner, or whoever added it); its copy is deleted. */
export async function removePicture(userId: number, albumId: number, pictureId: number): Promise<boolean> {
  const album = usableRow(userId, albumId);
  if (album?.kind !== "pictures") return false;
  const row = db.prepare("SELECT file_path, added_by FROM album_pictures WHERE id = ? AND album_id = ?").get(pictureId, albumId) as
    | { file_path: string; added_by: number | null }
    | undefined;
  if (!row || (album.user_id !== userId && row.added_by !== userId)) return false;
  db.prepare("DELETE FROM album_pictures WHERE id = ?").run(pictureId);
  db.prepare("UPDATE albums SET cover_picture_id = NULL WHERE id = ? AND cover_picture_id = ?").run(albumId, pictureId);
  if (row.file_path) await removeMediaFile(row.file_path);
  return true;
}

/** Move a picture one place earlier or later (the owner). */
export function movePicture(userId: number, albumId: number, pictureId: number, direction: "up" | "down"): boolean {
  if (ownRow(userId, albumId)?.kind !== "pictures") return false;
  const order = (db.prepare("SELECT id FROM album_pictures WHERE album_id = ? ORDER BY position, id").all(albumId) as { id: number }[]).map(
    (r) => r.id,
  );
  const i = order.indexOf(pictureId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return false;
  [order[i], order[j]] = [order[j], order[i]];
  transaction(() => {
    const set = db.prepare("UPDATE album_pictures SET position = ? WHERE id = ?");
    order.forEach((id, n) => set.run(n + 1, id));
  });
  return true;
}

/** The picture albums this person can add to, and whether this chat picture is in each (for "Add to album"). */
export function albumsForImage(userId: number, imageId: number): { id: number; name: string; mine: boolean; shared: boolean; has: boolean }[] {
  const adult = !!db
    .prepare("SELECT 1 FROM chat_images i JOIN conversations c ON c.id = i.conversation_id WHERE i.id = ? AND i.user_id = ? AND c.adult = 1")
    .get(imageId, userId);
  const choices = (
    db
      .prepare(
        `SELECT a.id, a.name, a.user_id = :uid AS mine,
                (a.everyone = 1 OR EXISTS (SELECT 1 FROM album_members am2 WHERE am2.album_id = a.id)) AS shared,
                EXISTS (SELECT 1 FROM album_pictures p WHERE p.album_id = a.id AND p.source_image_id = :image) AS has
           FROM albums a
          WHERE a.kind = 'pictures' AND (a.user_id = :uid OR a.everyone = 1
                OR EXISTS (SELECT 1 FROM album_members am WHERE am.album_id = a.id AND am.user_id = :uid))
          ORDER BY a.user_id <> :uid, a.updated_at DESC`,
      )
      .all({ uid: userId, image: imageId }) as { id: number; name: string; mine: number; shared: number; has: number }[]
  ).map((r) => ({ id: r.id, name: r.name, mine: !!r.mine, shared: !!r.shared, has: !!r.has }));
  // Adult pictures: only your own private albums.
  return adult ? choices.filter((c) => c.mine && !c.shared) : choices;
}

/** The picture in an album that came from this chat picture (for taking it out from the chat). */
export function pictureFromImage(albumId: number, imageId: number): number | undefined {
  return (db.prepare("SELECT id FROM album_pictures WHERE album_id = ? AND source_image_id = ?").get(albumId, imageId) as { id: number } | undefined)?.id;
}
