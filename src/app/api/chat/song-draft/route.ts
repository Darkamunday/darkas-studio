import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { makeSongDraft } from "@/lib/chat/song-draft";
import { OllamaError } from "@/lib/chat/ollama";

export const dynamic = "force-dynamic";

const Body = z.object({ messageId: z.number().int().positive() });

/** Prepare a reply for the Create page; the browser then opens /generate?fromChat=<messageId>. */
export async function POST(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  try {
    const draft = await makeSongDraft(auth.user.id, parsed.data.messageId);
    if (!draft) return Response.json({ error: "song_failed" }, { status: 422 });
    return Response.json({ ok: true });
  } catch (err) {
    if (!(err instanceof OllamaError)) console.error("[chat] song draft failed", err);
    return Response.json({ error: err instanceof OllamaError ? err.reason : "song_failed" }, { status: 502 });
  }
}
