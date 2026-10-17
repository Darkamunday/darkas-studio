import { db } from "@/lib/db";
import { requireVideoApi } from "@/lib/video/api";

export const dynamic = "force-dynamic";

/** Catalogue songs you can make a video for: your own (private ones included) and everyone's public ones. */
export async function GET() {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  const songs = (
    db
      .prepare(
        `SELECT t.id, t.title, t.duration, u.username, g.user_id = ? AS mine FROM tracks t
           JOIN generations g ON g.id = t.generation_id JOIN users u ON u.id = g.user_id
          WHERE g.status = 'complete' AND (t.is_private = 0 OR g.user_id = ?)
          ORDER BY mine DESC, t.created_at DESC LIMIT 500`,
      )
      .all(auth.user.id, auth.user.id) as { id: number; title: string | null; duration: number | null; username: string; mine: number }[]
  ).map((s) => ({ id: s.id, title: s.title, duration: s.duration, username: s.username, mine: !!s.mine }));
  return Response.json({ songs });
}
