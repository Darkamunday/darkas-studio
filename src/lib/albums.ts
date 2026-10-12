import "server-only";
import { db, transaction } from "./db";
import { coverVersion } from "./cover-url";
import { removeMediaFile } from "./storage";

export type AlbumKind = "music" | "pictures";

// Albums: music albums (songs) and picture albums (pictures and video made in chat — see
// picture-albums.ts). Each has an owner and is private unless shared with chosen people or (by an admin)
// with everyone. Shared albums are collaborative: everyone in one can add things, and remove the ones
// they added; only the owner renames it, sets its cover, reorders, shares or deletes it.
// Songs always follow the usual rule — a private song is only ever shown to the person who made it.

export const ALBUM_NAME_MAX = 80;
export const ALBUM_DESCRIPTION_MAX = 500;
export const MAX_ALBUMS_PER_USER = 50;
export const MAX_TRACKS_PER_ALBUM = 200;

export type AlbumRow = {
  id: number;
  user_id: number;
  owner: string;
  kind: AlbumKind;
  name: string;
  description: string | null;
  cover_track_id: number | null;
  cover_picture_id: number | null;
  everyone: number;
  updated_at: number;
};

type Person = { id: number; username: string };

/** An album as the browser sees it. Shared by server and client code. */
export type ClientAlbum = {
  id: number;
  kind: AlbumKind;
  name: string;
  description: string;
  /** This person owns it (and so can change it). */
  mine: boolean;
  /** The owner's name, for albums shared with this person. */
  owner: string | null;
  everyone: boolean;
  /** Who it's shared with — only sent to the owner. */
  members: Person[];
  /** This person was added by name (and so can leave). */
  member: boolean;
  /** Songs (or pictures) this person can see in it. */
  itemCount: number;
  coverUrl: string | null;
  /** The song or picture the owner picked as the cover. */
  coverTrackId: number | null;
  coverPictureId: number | null;
  updatedAt: number;
};

/** A song in an album, as this person sees it. */
export type AlbumTrack = {
  id: number;
  title: string | null;
  username: string;
  duration: number | null;
  audioUrl: string;
  coverUrl: string | null;
  /** Private: only its maker (this person) sees it here. */
  isPrivate: boolean;
  /** Who put it in the album. */
  addedBy: string | null;
  /** This person may take it out (the owner, or whoever added it). */
  canRemove: boolean;
};

const COLUMNS = `a.id, a.user_id, u.username AS owner, a.kind, a.name, a.description, a.cover_track_id, a.cover_picture_id, a.everyone, a.updated_at`;
const FROM = "FROM albums a JOIN users u ON u.id = a.user_id";
/** Albums this person can open: their own, ones shared with them, and ones shared with everyone. */
const USABLE = `(a.user_id = :uid OR a.everyone = 1
  OR EXISTS (SELECT 1 FROM album_members am WHERE am.album_id = a.id AND am.user_id = :uid))`;
/** Songs this person may see (finished, and public or their own). Over tracks t and generations g. */
const VISIBLE = "g.status = 'complete' AND (t.is_private = 0 OR g.user_id = :uid)";

const coverOf = (trackId: number, imagePath: string | null) => `/api/media/${trackId}/cover${coverVersion(imagePath)}`;

function members(albumId: number): Person[] {
  // Plain objects: these reach client components, which can't take SQLite rows.
  return (
    db
      .prepare(
        `SELECT u.id, u.username FROM album_members am JOIN users u ON u.id = am.user_id
          WHERE am.album_id = ? ORDER BY u.username COLLATE NOCASE`,
      )
      .all(albumId) as Person[]
  ).map(({ id, username }) => ({ id, username }));
}

/** A picture album's cover (the one picked, else the first still picture) and how many it holds. */
function pictureSummary(userId: number, a: AlbumRow): { coverUrl: string | null; count: number } {
  // Pictures from adult chats are only ever shown to whoever added them.
  const cover = db
    .prepare(
      `SELECT id FROM album_pictures WHERE album_id = ? AND kind = 'image' AND (adult = 0 OR added_by = ?)
        ORDER BY id = ? DESC, position LIMIT 1`,
    )
    .get(a.id, userId, a.cover_picture_id ?? 0) as { id: number } | undefined;
  const count = (
    db.prepare("SELECT COUNT(*) AS n FROM album_pictures WHERE album_id = ? AND (adult = 0 OR added_by = ?)").get(a.id, userId) as { n: number }
  ).n;
  return { coverUrl: cover ? `/api/albums/pictures/${cover.id}` : null, count };
}

function toClient(userId: number, a: AlbumRow): ClientAlbum {
  const mine = a.user_id === userId;
  const people = members(a.id);
  const base = {
    id: a.id,
    kind: a.kind,
    name: a.name,
    description: a.description ?? "",
    mine,
    owner: mine ? null : a.owner,
    everyone: !!a.everyone,
    members: mine ? people : [],
    member: people.some((p) => p.id === userId),
    coverTrackId: a.cover_track_id,
    coverPictureId: a.cover_picture_id,
    updatedAt: a.updated_at,
  };
  if (a.kind === "pictures") {
    const { coverUrl, count } = pictureSummary(userId, a);
    return { ...base, itemCount: count, coverUrl };
  }
  // The cover: the one the owner picked, if this person can see it; otherwise the first song with art.
  const covers = db
    .prepare(
      `SELECT t.id, t.image_path FROM album_tracks at JOIN tracks t ON t.id = at.track_id JOIN generations g ON g.id = t.generation_id
        WHERE at.album_id = :album AND ${VISIBLE} AND (t.image_path IS NOT NULL OR t.source_image_url IS NOT NULL)
        ORDER BY t.id = :cover DESC, at.position LIMIT 1`,
    )
    .get({ album: a.id, uid: userId, cover: a.cover_track_id ?? 0 }) as { id: number; image_path: string | null } | undefined;
  const count = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM album_tracks at JOIN tracks t ON t.id = at.track_id JOIN generations g ON g.id = t.generation_id
          WHERE at.album_id = :album AND ${VISIBLE}`,
      )
      .get({ album: a.id, uid: userId }) as { n: number }
  ).n;
  return { ...base, itemCount: count, coverUrl: covers ? coverOf(covers.id, covers.image_path) : null };
}

/** Every album of one kind this person can open: their own first, then shared ones, most recently changed first. */
export function listAlbums(userId: number, kind: AlbumKind = "music"): ClientAlbum[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE ${USABLE} AND a.kind = :kind ORDER BY a.user_id <> :uid, a.updated_at DESC, a.id DESC`)
    .all({ uid: userId, kind }) as AlbumRow[];
  return rows.map((a) => toClient(userId, a));
}

/** An album this person can open (for picture-albums.ts and here). */
export function usableRow(userId: number, id: number): AlbumRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE a.id = :id AND ${USABLE}`).get({ uid: userId, id }) as AlbumRow | undefined;
}

/** An album this person owns. */
export function ownRow(userId: number, id: number): AlbumRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE a.id = :id AND a.user_id = :uid`).get({ uid: userId, id }) as AlbumRow | undefined;
}

/** An album this person can open. */
export function getAlbum(userId: number, id: number): ClientAlbum | undefined {
  const row = usableRow(userId, id);
  return row && toClient(userId, row);
}

export function countOwnAlbums(userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM albums WHERE user_id = ?").get(userId) as { n: number }).n;
}

export type AlbumInput = {
  /** Set when it's made; can't change after. */
  kind?: AlbumKind;
  name?: string;
  description?: string | null;
  /** Who it's shared with (replaces the list). */
  memberIds?: number[];
  /** Shared with everyone. Callers only pass true for admins. */
  everyone?: boolean;
  /** The song whose art is the cover (must be in the album), or null for the first one. */
  coverTrackId?: number | null;
  /** The picture that's the cover (must be in the album), or null for the first one. */
  coverPictureId?: number | null;
};

export function createAlbum(userId: number, input: AlbumInput & { name: string }): ClientAlbum {
  const id = transaction(() => {
    const id = Number(
      db.prepare("INSERT INTO albums (user_id, name, kind) VALUES (?, ?, ?)").run(userId, input.name, input.kind ?? "music").lastInsertRowid,
    );
    applyUpdate(userId, id, input);
    return id;
  });
  return getAlbum(userId, id)!;
}

export function updateAlbum(userId: number, id: number, input: AlbumInput): ClientAlbum | undefined {
  if (!ownRow(userId, id)) return undefined;
  transaction(() => applyUpdate(userId, id, input));
  return getAlbum(userId, id);
}

function applyUpdate(userId: number, id: number, input: AlbumInput) {
  const set = (column: string, value: string | number | null) =>
    db.prepare(`UPDATE albums SET ${column} = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?`).run(value, id, userId);
  if (input.name !== undefined) set("name", input.name.trim());
  if (input.description !== undefined) set("description", input.description?.trim() || null);
  if (input.everyone !== undefined) set("everyone", input.everyone ? 1 : 0);
  if (input.coverTrackId !== undefined) {
    const inAlbum =
      input.coverTrackId !== null && !!db.prepare("SELECT 1 FROM album_tracks WHERE album_id = ? AND track_id = ?").get(id, input.coverTrackId);
    set("cover_track_id", inAlbum ? input.coverTrackId : null);
  }
  if (input.coverPictureId !== undefined) {
    const inAlbum =
      input.coverPictureId !== null &&
      !!db.prepare("SELECT 1 FROM album_pictures WHERE album_id = ? AND id = ? AND kind = 'image'").get(id, input.coverPictureId);
    set("cover_picture_id", inAlbum ? input.coverPictureId : null);
  }
  if (input.memberIds !== undefined) {
    db.prepare("DELETE FROM album_members WHERE album_id = ?").run(id);
    const add = db.prepare(
      "INSERT OR IGNORE INTO album_members (album_id, user_id) SELECT ?, id FROM users WHERE id = ? AND id <> ? AND disabled = 0",
    );
    for (const memberId of new Set(input.memberIds)) add.run(id, memberId, userId);
  }
}

/** Delete an album. Songs aren't touched; a picture album's own copies of its pictures are deleted. */
export async function deleteAlbum(userId: number, id: number): Promise<boolean> {
  if (!ownRow(userId, id)) return false;
  const files = db.prepare("SELECT file_path FROM album_pictures WHERE album_id = ?").all(id) as { file_path: string }[];
  db.prepare("DELETE FROM albums WHERE id = ? AND user_id = ?").run(id, userId);
  for (const f of files) await removeMediaFile(f.file_path).catch(() => {});
  return true;
}

/** Leave an album shared with you. Songs you added stay in it. */
export function leaveAlbum(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM album_members WHERE album_id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Everyone an album can be shared with: other people whose accounts are on. */
export function albumPeople(userId: number): Person[] {
  return (
    db
      .prepare("SELECT id, username FROM users WHERE id <> ? AND disabled = 0 ORDER BY username COLLATE NOCASE")
      .all(userId) as Person[]
  ).map(({ id, username }) => ({ id, username }));
}

// ---- songs ------------------------------------------------------------------------------

/** The songs in an album this person can see, in order. Undefined if they can't open it. */
export function albumTracks(userId: number, albumId: number): AlbumTrack[] | undefined {
  const album = usableRow(userId, albumId);
  if (!album) return undefined;
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.duration, t.image_path, t.source_image_url, t.is_private, u.username, at.added_by, adder.username AS added_by_name
         FROM album_tracks at
         JOIN tracks t ON t.id = at.track_id
         JOIN generations g ON g.id = t.generation_id
         JOIN users u ON u.id = g.user_id
         LEFT JOIN users adder ON adder.id = at.added_by
        WHERE at.album_id = :album AND ${VISIBLE}
        ORDER BY at.position, at.added_at`,
    )
    .all({ album: albumId, uid: userId }) as {
    id: number;
    title: string | null;
    duration: number | null;
    image_path: string | null;
    source_image_url: string | null;
    is_private: number;
    username: string;
    added_by: number | null;
    added_by_name: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    username: r.username,
    duration: r.duration,
    audioUrl: `/api/media/${r.id}`,
    coverUrl: r.image_path || r.source_image_url ? coverOf(r.id, r.image_path) : null,
    isPrivate: !!r.is_private,
    addedBy: r.added_by_name,
    canRemove: album.user_id === userId || r.added_by === userId,
  }));
}

export type AddResult = "added" | "already" | "not_found" | "full";

/** Put a song this person can see into an album they can open (at the end). */
export function addTrack(userId: number, albumId: number, trackId: number): AddResult {
  if (usableRow(userId, albumId)?.kind !== "music") return "not_found";
  const visible = db
    .prepare(`SELECT 1 FROM tracks t JOIN generations g ON g.id = t.generation_id WHERE t.id = :track AND ${VISIBLE}`)
    .get({ track: trackId, uid: userId });
  if (!visible) return "not_found";
  return transaction(() => {
    if (db.prepare("SELECT 1 FROM album_tracks WHERE album_id = ? AND track_id = ?").get(albumId, trackId)) return "already";
    const { n, last } = db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM album_tracks WHERE album_id = ?").get(albumId) as {
      n: number;
      last: number;
    };
    if (n >= MAX_TRACKS_PER_ALBUM) return "full";
    db.prepare("INSERT INTO album_tracks (album_id, track_id, added_by, position) VALUES (?, ?, ?, ?)").run(albumId, trackId, userId, last + 1);
    db.prepare("UPDATE albums SET updated_at = unixepoch() WHERE id = ?").run(albumId);
    return "added";
  });
}

/** Take a song out: the album's owner, or whoever added it. */
export function removeTrack(userId: number, albumId: number, trackId: number): boolean {
  const album = usableRow(userId, albumId);
  if (!album) return false;
  const r = db
    .prepare("DELETE FROM album_tracks WHERE album_id = ? AND track_id = ? AND (? OR added_by = ?)")
    .run(albumId, trackId, album.user_id === userId ? 1 : 0, userId);
  if (r.changes) db.prepare("UPDATE albums SET cover_track_id = NULL WHERE id = ? AND cover_track_id = ?").run(albumId, trackId);
  return r.changes > 0;
}

/** Move a song one place up or down (owner only), among the songs the owner sees. */
export function moveTrack(userId: number, albumId: number, trackId: number, direction: "up" | "down"): boolean {
  if (!ownRow(userId, albumId)) return false;
  const order = (albumTracks(userId, albumId) ?? []).map((t) => t.id);
  const at = order.indexOf(trackId);
  const other = order[direction === "up" ? at - 1 : at + 1];
  if (at < 0 || other === undefined) return false;
  transaction(() => {
    // Swap the two in the full order (songs hidden from the owner keep their places), then number 1..n.
    const all = (
      db.prepare("SELECT track_id FROM album_tracks WHERE album_id = ? ORDER BY position, added_at").all(albumId) as { track_id: number }[]
    ).map((r) => r.track_id);
    const [i, j] = [all.indexOf(trackId), all.indexOf(other)];
    [all[i], all[j]] = [all[j], all[i]];
    const set = db.prepare("UPDATE album_tracks SET position = ? WHERE album_id = ? AND track_id = ?");
    all.forEach((id, n) => set.run(n + 1, albumId, id));
  });
  return true;
}

/** The albums this person can put a song in, and whether it's already in each (for "Add to album"). */
export function albumsForTrack(userId: number, trackId: number): { id: number; name: string; mine: boolean; shared: boolean; has: boolean }[] {
  return (
    db
      .prepare(
        `SELECT a.id, a.name, a.user_id = :uid AS mine,
                (a.everyone = 1 OR EXISTS (SELECT 1 FROM album_members am2 WHERE am2.album_id = a.id)) AS shared,
                EXISTS (SELECT 1 FROM album_tracks at WHERE at.album_id = a.id AND at.track_id = :track) AS has
           FROM albums a WHERE ${USABLE} AND a.kind = 'music' ORDER BY a.user_id <> :uid, a.updated_at DESC`,
      )
      .all({ uid: userId, track: trackId }) as { id: number; name: string; mine: number; shared: number; has: number }[]
  ).map((r) => ({ id: r.id, name: r.name, mine: !!r.mine, shared: !!r.shared, has: !!r.has }));
}
