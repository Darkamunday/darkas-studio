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
import { setPinnedSkills, skillsForMessage, slashSlug } from "@/lib/chat/skills";
import { getMasterPrompt } from "@/lib/chat/master-prompt";
import type { ChatEvent } from "@/lib/chat/events";
import {
  OllamaError,
  completeChat,
  streamChat,
  type ChatTurn,
  type TokenUsage,
  type ToolCall,
  type ToolDef,
} from "@/lib/chat/ollama";
import {
  attachImagesToMessage,
  canMakeImage,
  hasImageAccess,
  imageCapFor,
  listImages,
  startImage,
} from "@/lib/chat/images";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_ASPECTS,
  MAX_IMAGE_PROMPT_CHARS,
  allowedImageModel,
  isImageAspect,
  type ImageAspect,
} from "@/config/images";
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

/** Image settings from the browser: the model and shape picked, and whether to improve the prompt first. */
const ImagePrefs = z
  .object({
    model: z.string().optional(),
    aspect: z.enum(Object.keys(IMAGE_ASPECTS) as [ImageAspect, ...ImageAspect[]]).optional(),
    improve: z.boolean().optional(),
  })
  .optional();

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
    /** Skills pinned before a new chat existed; pinned when it's created. */
    skillIds: z.array(z.number().int().positive()).max(50).optional(),
    image: ImagePrefs,
  }),
  z.object({
    conversationId: z.number().int().positive(),
    regenerate: z.literal(true),
    model: z.string().optional(),
    think: z.boolean().optional(),
    image: ImagePrefs,
  }),
]);

const TITLE_MAX = 60;

/** The image tool offered to models that can call tools (when the person can make images). */
const IMAGE_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Create an image and show it to the person. Use it when they ask for a picture, drawing, artwork, photo, cover or visual — or clearly want to see something. Don't use it otherwise.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "A detailed visual description for the image generator: subject, appearance (use any character details from the reference files), setting, lighting, composition and style.",
        },
        aspect: { type: "string", enum: Object.keys(IMAGE_ASPECTS), description: "Shape: square (default), portrait or landscape." },
      },
      required: ["prompt"],
    },
  },
};

const IMPROVE_IMAGE_PROMPT = `Rewrite the person's image request as one detailed prompt for an image generator: the subject, their appearance (use any character details from the reference files above), the setting, lighting, composition and art style. Stay true to what they asked for. Under 120 words. Reply with the prompt only.`;

/** The system prompt's list of images already made in this chat (see systemPrompt's `images`). */
const imagesNote = (descriptions: string[]) => systemPrompt({ base: "", images: descriptions });

/** Drop any "[Image shown…]"-style note a model imitates into its reply; people never need to see it. */
const stripImageNotes = (text: string) => text.replace(/^\[Image (?:shown|made)[^\n]*$\n?/gim, "").trim();

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
  const newSkillIds = !conversation && "skillIds" in body ? (body.skillIds ?? []) : [];
  const files = filesForChat(user.id, conversation?.id ?? null, newFileIds, project?.id ?? null);
  // A /skill at the start of the message applies to this reply (and to regenerating it).
  const asked =
    "content" in body
      ? body.content
      : (conversation ? listMessages(user.id, conversation.id).findLast((msg) => msg.role === "user")?.content : undefined);
  const skills = skillsForMessage(user.id, {
    conversationId: conversation?.id ?? null,
    projectId: project?.id ?? null,
    extraIds: newSkillIds,
    slug: asked ? slashSlug(asked) : null,
  });
  const system = systemPrompt({
    base: getMasterPrompt().text,
    instructions: getInstructions(user.id),
    project: project ? { name: project.name, instructions: project.instructions } : null,
    skills,
    files,
  });
  if (estimateTokens([{ role: "system", content: system }]) > model.contextTokens - MAX_REPLY_TOKENS - MIN_CONVERSATION_TOKENS) {
    return Response.json({ error: "files_too_big", model: model.label }, { status: 413 });
  }

  // Images: "/image <description>" makes one directly; otherwise models that can call tools may make
  // one themselves. Both need image access and allowance left today.
  const imageCommand = asked ? /^\/image(?:\s+([\s\S]*))?$/.exec(asked) : null;
  const imagePrompt = imageCommand?.[1]?.trim().slice(0, MAX_IMAGE_PROMPT_CHARS) ?? "";
  const imageModel = allowedImageModel(body.image?.model, isAdmin)?.id ?? DEFAULT_IMAGE_MODEL;
  const imageAspect: ImageAspect = body.image?.aspect ?? "square";
  if (imageCommand) {
    if (!imagePrompt) return Response.json({ error: "bad_request" }, { status: 400 });
    if (!hasImageAccess(user.id)) return Response.json({ error: "images_disabled" }, { status: 403 });
    if (!canMakeImage(user.id)) return Response.json({ error: "image_cap", cap: imageCapFor(user.id) }, { status: 429 });
  }
  const offerImageTool = !imageCommand && !!model.tools && canMakeImage(user.id);

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
  if (newSkillIds.length) setPinnedSkills(user.id, { conversationId }, newSkillIds);

  // Image-only replies have no text to send; the images themselves are listed in the system prompt.
  const history = listMessages(user.id, conversationId)
    .map<ChatTurn>((m) => ({ role: m.role, content: m.role === "assistant" ? stripImageNotes(m.content) : m.content }))
    .filter((m) => m.role !== "assistant" || m.content);
  if (history.at(-1)?.role !== "user") return Response.json({ error: "nothing_to_answer" }, { status: 400 });

  // The model can't see images, so ones it already made are described in the system prompt.
  const madeImages = listImages(user.id, conversationId)
    .filter((i) => i.status === "ready" && i.messageId !== null)
    .slice(-10)
    .map((i) => i.prompt.slice(0, 300));
  const prompt = buildPrompt(madeImages.length ? `${system}${imagesNote(madeImages)}` : system, history, model);
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
      const imageIds: number[] = [];

      /** Make one image, telling the browser as it starts and as it finishes. */
      const makeImage = async (description: string, aspect: ImageAspect) => {
        const { image, done } = startImage({ userId: user.id, conversationId, prompt: description, modelId: imageModel, aspect });
        imageIds.push(image.id);
        send({ type: "image", image });
        const finished = await done;
        send({ type: "image", image: finished });
        return finished;
      };

      /** One streamed model call; text and reasoning go to the browser as they arrive. */
      const streamTurn = async (messages: ChatTurn[], tools?: ToolDef[]) => {
        const calls: ToolCall[] = [];
        let usage: TokenUsage | null = null;
        let output = "";
        try {
          for await (const piece of streamChat({
            model: model.id,
            messages,
            numCtx: model.contextTokens,
            // The Think toggle (on unless switched off), for models that can reason.
            think: model.thinking ? body.think !== false : undefined,
            tools,
            signal: req.signal,
            onUsage: (u) => (usage = u),
          })) {
            if (piece.kind === "tool_call") calls.push(piece.call);
            else if (piece.kind === "thinking") {
              thinkStart ??= Date.now();
              thinking += piece.text;
              output += piece.text;
              send({ type: "thinking", text: piece.text });
            } else {
              if (thinkStart !== null) thinkEnd ??= Date.now();
              reply += piece.text;
              output += piece.text;
              send({ type: "delta", text: piece.text });
            }
          }
        } finally {
          // Count what it cost. A reply cut short never reports its tokens, so those are estimated.
          if (usage) recordSpend(user.id, model.id, usage);
          else if (output || req.signal.aborted) {
            recordSpend(user.id, model.id, { input: estimateTokens(messages), output: Math.ceil(output.length / 4) }, true);
          }
        }
        return calls;
      };

      try {
        if (imageCommand) {
          // "/image": straight to the image generator, optionally with the description improved first.
          let description = imagePrompt;
          if (body.image?.improve) {
            try {
              const { text, usage } = await completeChat(model.id, [
                { role: "system", content: `${system}\n\n${IMPROVE_IMAGE_PROMPT}` },
                { role: "user", content: imagePrompt },
              ]);
              if (usage) recordSpend(user.id, model.id, usage);
              if (text.trim()) description = text.trim().replace(/^["“]|["”]$/g, "").slice(0, MAX_IMAGE_PROMPT_CHARS);
            } catch (err) {
              console.error("[chat] improving the image prompt failed", err);
            }
          }
          await makeImage(description, imageAspect);
        } else {
          const calls = await streamTurn(prompt, offerImageTool ? [IMAGE_TOOL] : undefined);
          const imageCalls = calls.filter((c) => c.function.name === "generate_image").slice(0, 2);
          if (imageCalls.length && !req.signal.aborted) {
            const results: ChatTurn[] = [];
            for (const call of imageCalls) {
              const args = call.function.arguments ?? {};
              const description = String(args.prompt ?? "").trim().slice(0, MAX_IMAGE_PROMPT_CHARS);
              let result: string;
              if (!description) result = "No image made: the description was empty.";
              else if (!canMakeImage(user.id)) result = "No image made: the person has reached today's image limit. Tell them kindly.";
              else {
                const made = await makeImage(description, isImageAspect(args.aspect) ? args.aspect : imageAspect);
                result =
                  made.status === "ready"
                    ? `Done: the image is now shown to the person (prompt used: "${description}"). You can't see it, so don't describe details as if you could — briefly say what you made and offer to adjust it.`
                    : "The image couldn't be made this time. Apologise briefly and suggest trying again.";
              }
              results.push({ role: "tool", content: result, tool_name: "generate_image" });
            }
            // Let the model finish its reply now it knows how the image went (no more tools this turn).
            if (reply.trim()) {
              reply += "\n\n";
              send({ type: "delta", text: "\n\n" });
            }
            await streamTurn([...prompt, { role: "assistant", content: reply.trim(), tool_calls: imageCalls }, ...results]);
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          const reason = err instanceof OllamaError ? err.reason : "generic";
          if (!(err instanceof OllamaError)) console.error("[chat] stream failed", err);
          send({ type: "error", reason });
        }
      } finally {
        // Keep whatever arrived — the whole reply, the part before Stop or an error, and any images.
        thinkingMs = thinkStart === null ? null : (thinkEnd ?? Date.now()) - thinkStart;
        if (reply.trim() || imageIds.length) {
          messageId = addMessage(conversationId, "assistant", stripImageNotes(reply), thinking ? { text: thinking, ms: thinkingMs } : null);
          attachImagesToMessage(imageIds, messageId);
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
