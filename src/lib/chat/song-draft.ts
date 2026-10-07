import "server-only";
import { db } from "../db";
import { TITLE_MAX, limitsFor } from "../models";
import { DEFAULT_MODEL } from "@/config/chat";
import { completeChat } from "./ollama";
import { recordSpend } from "./spend";

// "Make it a song": turns an assistant reply into a title, style and lyrics for the Create page's
// advanced form. The result is stored on the message, so it's made (and paid for) once.

export type SongDraft = { title: string; style: string; lyrics: string };

// The most the advanced form accepts on any model; it trims further for the one picked.
const LYRICS_MAX = limitsFor("V6").lyrics;
const STYLE_MAX = limitsFor("V6").style;

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, style: { type: "string" }, lyrics: { type: "string" } },
  required: ["title", "style", "lyrics"],
};

const INSTRUCTIONS = `You prepare songs for an AI music generator from a chat. Given the person's request and the assistant's reply, return JSON with:
- "title": a short song title (max 60 characters).
- "style": the musical style as comma-separated descriptors — genre, mood, tempo, instruments, vocals (e.g. "dreamy synth-pop, female vocals, mid-tempo, warm pads"). Max 200 characters.
- "lyrics": the song's lyrics with section tags on their own lines, like [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro].
If the reply already contains lyrics, use them exactly as written — only add section tags where they're missing, and drop any commentary around them. If it has no lyrics, write original lyrics that capture what the conversation is about.
Reply with the JSON only.`;

type Row = { id: number; role: string; content: string; song_draft: string | null; conversation_id: number };

/** The assistant reply `messageId`, if it's in one of this person's chats. */
function ownReply(userId: number, messageId: number): Row | undefined {
  return db
    .prepare(
      `SELECT m.id, m.role, m.content, m.song_draft, m.conversation_id
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = ? AND c.user_id = ? AND m.role = 'assistant'`,
    )
    .get(messageId, userId) as Row | undefined;
}

function parse(json: string | null): SongDraft | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Partial<SongDraft>;
    if (typeof d.lyrics !== "string" || !d.lyrics.trim()) return null;
    return {
      title: String(d.title ?? "").replace(/^["'“”]+|["'“”]+$/g, "").trim().slice(0, TITLE_MAX),
      style: String(d.style ?? "").trim().slice(0, STYLE_MAX),
      lyrics: d.lyrics.trim().slice(0, LYRICS_MAX),
    };
  } catch {
    return null;
  }
}

/** A draft already made for this reply (for the Create page), or null. */
export function getSongDraft(userId: number, messageId: number): SongDraft | null {
  return parse(ownReply(userId, messageId)?.song_draft ?? null);
}

/** Make (or reuse) the draft for this reply. Null if the reply isn't theirs or the model gave nothing usable. */
export async function makeSongDraft(userId: number, messageId: number): Promise<SongDraft | null> {
  const reply = ownReply(userId, messageId);
  if (!reply) return null;
  const cached = parse(reply.song_draft);
  if (cached) return cached;

  // The question it answered gives the model the mood and subject.
  const asked = db
    .prepare("SELECT content FROM messages WHERE conversation_id = ? AND id < ? AND role = 'user' ORDER BY id DESC LIMIT 1")
    .get(reply.conversation_id, reply.id) as { content: string } | undefined;

  const { text, usage } = await completeChat(
    DEFAULT_MODEL,
    [
      { role: "system", content: INSTRUCTIONS },
      {
        role: "user",
        content: `The person asked:\n${(asked?.content ?? "").slice(0, 4000)}\n\nThe assistant replied:\n${reply.content.slice(0, 12000)}`,
      },
    ],
    { timeoutMs: 90_000, format: SCHEMA },
  );
  if (usage) recordSpend(userId, DEFAULT_MODEL, usage);

  const draft = parse(text);
  if (draft) db.prepare("UPDATE messages SET song_draft = ? WHERE id = ?").run(JSON.stringify(draft), reply.id);
  return draft;
}
