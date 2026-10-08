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
import { buildPrompt, estimateTokens, systemPrompt } from "@/lib/chat/context";
import { recordSpend } from "@/lib/chat/spend";
import { filesForChat, setAttachedFiles } from "@/lib/chat/files";
import { getProject } from "@/lib/chat/projects";
import { getMasterPrompt } from "@/lib/chat/master-prompt";
import type { ChatEvent } from "@/lib/chat/events";
import { OllamaError, completeChat, streamChat, type ChatTurn, type TokenUsage } from "@/lib/chat/ollama";
import {
  CHAT_MODELS,
  DEFAULT_MODEL,
  MAX_FILES_PER_USER,
  MAX_MESSAGE_CHARS,
  MAX_REPLY_TOKENS,
  allowedModel,
  findChatModel,
} from "@/config/chat";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({
    conversationId: z.number().int().positive().optional(),
    content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    model: z.string().optional(),
    think: z.boolean().optional(),
    /** Files picked before a new chat existed; attached when it's created. */
    fileIds: z.array(z.number().int().positive()).max(MAX_FILES_PER_USER).optional(),
    /** The project a new chat starts in. */
    projectId: z.number().int().positive().optional(),
  }),
  z.object({
    conversationId: z.number().int().positive(),
    regenerate: z.literal(true),
    model: z.string().optional(),
    think: z.boolean().optional(),
  }),
]);

const TITLE_MAX = 60;

/** Room kept for the conversation itself when reference files fill the model's window. */
const MIN_CONVERSATION_TOKENS = 2_000;

function fallbackTitle(text: string) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX ? `${oneLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : oneLine;
}

async function makeTitle(userId: number, model: string, firstMessage: string): Promise<string> {
  try {
    const { text: raw, usage } = await completeChat(model, [
      {
        role: "system",
        content: "Write a short title (2–6 words) for a chat that starts with the user's message below. Reply with the title only — no quotes, no full stop.",
      },
      { role: "user", content: firstMessage.slice(0, 2000) },
    ]);
    if (usage) recordSpend(userId, model, usage);
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

  const isAdmin = !!user.is_admin;
  const requestedModel = allowedModel(body.model, isAdmin);
  if (body.model && !requestedModel) return Response.json({ error: "bad_model" }, { status: 400 });

  // The model that will answer: the one asked for, else the chat's own (if still allowed), else the default.
  const model =
    requestedModel ??
    (conversation ? allowedModel(conversation.model, isAdmin) : undefined) ??
    findChatModel(DEFAULT_MODEL) ??
    CHAT_MODELS[0];

  // The chat's project: its own for an existing chat, or the one a new chat is started in.
  const projectId = conversation ? conversation.project_id : "projectId" in body ? (body.projectId ?? null) : null;
  const project = projectId ? getProject(user.id, projectId) : undefined;
  if (projectId && !project && !conversation) return Response.json({ error: "not_found" }, { status: 404 });

  // Reference files go in the system prompt. Check they fit before saving anything, so a refused
  // message isn't stored or counted.
  const newFileIds = !conversation && "fileIds" in body ? (body.fileIds ?? []) : [];
  const files = filesForChat(user.id, conversation?.id ?? null, newFileIds, project?.id ?? null);
  const system = systemPrompt(
    getMasterPrompt().text,
    getInstructions(user.id),
    files,
    project ? { name: project.name, instructions: project.instructions } : null,
  );
  if (estimateTokens([{ role: "system", content: system }]) > model.contextTokens - MAX_REPLY_TOKENS - MIN_CONVERSATION_TOKENS) {
    return Response.json({ error: "files_too_big", model: model.label }, { status: 413 });
  }

  // Save the user's side first, so it's kept even if the model never answers.
  let userMessageId: number | null = null;
  const conversationId = transaction(() => {
    const id = conversation?.id ?? createConversation(user.id, requestedModel?.id ?? DEFAULT_MODEL, project?.id ?? null);
    if (conversation && requestedModel && requestedModel.id !== conversation.model) {
      setConversationModel(user.id, id, requestedModel.id);
    }
    if ("regenerate" in body) dropLastAssistant(id);
    else userMessageId = addMessage(id, "user", body.content);
    recordSend(user.id);
    return id;
  });
  conversation = getConversation(user.id, conversationId)!;
  if (newFileIds.length) setAttachedFiles(user.id, conversationId, newFileIds);

  const history = listMessages(user.id, conversationId).map<ChatTurn>((m) => ({ role: m.role, content: m.content }));
  if (history.at(-1)?.role !== "user") return Response.json({ error: "nothing_to_answer" }, { status: 400 });

  const prompt = buildPrompt(system, history, model);
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
      let thinking = "";
      let thinkStart: number | null = null;
      let thinkEnd: number | null = null;
      let messageId: number | null = null;
      let thinkingMs: number | null = null;
      let usage: TokenUsage | null = null;
      try {
        for await (const piece of streamChat({
          model: model.id,
          messages: prompt,
          numCtx: model.contextTokens,
          // The Think toggle (on unless switched off), for models that can reason.
          think: model.thinking ? body.think !== false : undefined,
          signal: req.signal,
          onUsage: (u) => (usage = u),
        })) {
          if (piece.kind === "thinking") {
            thinkStart ??= Date.now();
            thinking += piece.text;
            send({ type: "thinking", text: piece.text });
          } else {
            if (thinkStart !== null) thinkEnd ??= Date.now();
            reply += piece.text;
            send({ type: "delta", text: piece.text });
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          if (!(err instanceof OllamaError)) console.error("[chat] stream failed", err);
          send({ type: "error", reason: err instanceof OllamaError ? err.reason : "generic" });
        }
      } finally {
        // Keep whatever arrived — the whole reply, or the part before Stop or an error.
        thinkingMs = thinkStart === null ? null : (thinkEnd ?? Date.now()) - thinkStart;
        if (reply.trim()) {
          messageId = addMessage(conversationId, "assistant", reply, thinking ? { text: thinking, ms: thinkingMs } : null);
        }
        // Count what it cost. A reply cut short never reports its tokens, so those are estimated.
        if (usage) recordSpend(user.id, model.id, usage);
        else if (reply || thinking || req.signal.aborted) {
          const output = Math.ceil((reply.length + thinking.length) / 4);
          recordSpend(user.id, model.id, { input: estimateTokens(prompt), output }, true);
        }
      }
      send({ type: "done", messageId, thinkingMs });

      if (needsTitle) {
        const title = req.signal.aborted ? fallbackTitle(firstUserMessage) : await makeTitle(user.id, model.id, firstUserMessage);
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
