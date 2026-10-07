import type { NextRequest } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { capFor, recordSend, requireChatApi, sentToday } from "@/lib/chat/access";
import {
  addMessage,
  createConversation,
  dropLastAssistant,
  getConversation,
  getInstructions,
  listMessages,
  renameConversation,
  setConversationModel,
} from "@/lib/chat/store";
import { buildPrompt, systemPrompt } from "@/lib/chat/context";
import { getMasterPrompt } from "@/lib/chat/master-prompt";
import type { ChatEvent } from "@/lib/chat/events";
import { OllamaError, completeChat, streamChat, type ChatTurn } from "@/lib/chat/ollama";
import { CHAT_MODELS, DEFAULT_MODEL, MAX_MESSAGE_CHARS, findChatModel } from "@/config/chat";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({
    conversationId: z.number().int().positive().optional(),
    content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    model: z.string().optional(),
  }),
  z.object({
    conversationId: z.number().int().positive(),
    regenerate: z.literal(true),
    model: z.string().optional(),
  }),
]);

const TITLE_MAX = 60;

function fallbackTitle(text: string) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX ? `${oneLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : oneLine;
}

async function makeTitle(model: string, firstMessage: string): Promise<string> {
  try {
    const raw = await completeChat(model, [
      {
        role: "system",
        content: "Write a short title (2–6 words) for a chat that starts with the user's message below. Reply with the title only — no quotes, no full stop.",
      },
      { role: "user", content: firstMessage.slice(0, 2000) },
    ]);
    const title = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'“”#*\s]+|["'“”.*\s]+$/g, "").split("\n")[0];
    if (title) return fallbackTitle(title);
  } catch (err) {
    console.error("[chat] title generation failed", err);
  }
  return fallbackTitle(firstMessage);
}

export async function POST(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const user = auth.user;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const body = parsed.data;

  const cap = capFor(user.id);
  if (cap !== null && sentToday(user.id) >= cap) return Response.json({ error: "daily_cap", cap }, { status: 429 });

  let conversation = body.conversationId ? getConversation(user.id, body.conversationId) : undefined;
  if (body.conversationId && !conversation) return Response.json({ error: "not_found" }, { status: 404 });

  const requestedModel = findChatModel(body.model);
  if (body.model && !requestedModel) return Response.json({ error: "bad_model" }, { status: 400 });

  // Save the user's side first, so it's kept even if the model never answers.
  let userMessageId: number | null = null;
  const conversationId = transaction(() => {
    const id = conversation?.id ?? createConversation(user.id, requestedModel?.id ?? DEFAULT_MODEL);
    if (conversation && requestedModel && requestedModel.id !== conversation.model) {
      setConversationModel(user.id, id, requestedModel.id);
    }
    if ("regenerate" in body) dropLastAssistant(id);
    else userMessageId = addMessage(id, "user", body.content);
    recordSend(user.id);
    return id;
  });
  conversation = getConversation(user.id, conversationId)!;

  const history = listMessages(user.id, conversationId).map<ChatTurn>((m) => ({ role: m.role, content: m.content }));
  if (history.at(-1)?.role !== "user") return Response.json({ error: "nothing_to_answer" }, { status: 400 });

  // A model removed from the config since the chat started falls back to the default.
  const model = findChatModel(conversation.model) ?? findChatModel(DEFAULT_MODEL) ?? CHAT_MODELS[0];
  const prompt = buildPrompt(systemPrompt(getMasterPrompt().text, getInstructions(user.id)), history, model);
  const needsTitle = !conversation.title;
  const firstUserMessage = history.find((m) => m.role === "user")!.content;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false; // the browser went away
        }
      };

      send({ type: "meta", conversationId, userMessageId, usage: { sent: sentToday(user.id), cap } });

      let reply = "";
      let messageId: number | null = null;
      try {
        for await (const text of streamChat({ model: model.id, messages: prompt, numCtx: model.contextTokens, signal: req.signal })) {
          reply += text;
          send({ type: "delta", text });
        }
      } catch (err) {
        if (!req.signal.aborted) {
          if (!(err instanceof OllamaError)) console.error("[chat] stream failed", err);
          send({ type: "error", reason: err instanceof OllamaError ? err.reason : "generic" });
        }
      } finally {
        // Keep whatever arrived — the whole reply, or the part before Stop or an error.
        if (reply.trim()) messageId = addMessage(conversationId, "assistant", reply);
      }
      send({ type: "done", messageId });

      if (needsTitle) {
        const title = req.signal.aborted ? fallbackTitle(firstUserMessage) : await makeTitle(model.id, firstUserMessage);
        renameConversation(user.id, conversationId, title);
        send({ type: "title", title });
      }

      if (open) {
        open = false;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Stops proxies (e.g. Nginx) from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
