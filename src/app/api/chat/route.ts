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
import { claimUploads, imagesForPrompt, unsentUploads, uploadCounts } from "@/lib/chat/uploads";
import {
  LOAD_TOOLS,
  attachToolCallsToMessage,
  declineToolCall,
  loadTools,
  pendingApproval,
  runToolCall,
  toolsetFor,
  type ClientToolCall,
} from "@/lib/chat/tools";
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
  type ClientImage,
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
  MAX_IMAGES_PER_MESSAGE,
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
  z
    .object({
    conversationId: z.number().int().positive().optional(),
    content: z.string().trim().max(MAX_MESSAGE_CHARS),
    /** Pictures uploaded for this message (for models that can see them). */
    imageIds: z.array(z.number().int().positive()).max(MAX_IMAGES_PER_MESSAGE).optional(),
    model: z.string().optional(),
    think: z.boolean().optional(),
    /** Files picked before a new chat existed; attached when it's created. */
    fileIds: z.array(z.number().int().positive()).max(MAX_FILES_PER_USER).optional(),
    /** The project a new chat starts in. */
    projectId: z.number().int().positive().optional(),
    /** Skills pinned before a new chat existed; pinned when it's created. */
    skillIds: z.array(z.number().int().positive()).max(50).optional(),
    image: ImagePrefs,
  })
    // Text, pictures or both.
    .refine((b) => b.content.length > 0 || !!b.imageIds?.length),
  z.object({
    conversationId: z.number().int().positive(),
    regenerate: z.literal(true),
    model: z.string().optional(),
    think: z.boolean().optional(),
    image: ImagePrefs,
  }),
  // Carry on after an approval card: run (or skip) the paused tool, then let the model continue.
  z.object({
    conversationId: z.number().int().positive(),
    resume: z.object({ toolCallId: z.number().int().positive(), decision: z.enum(["approve", "decline"]) }),
    model: z.string().optional(),
    think: z.boolean().optional(),
    image: ImagePrefs,
  }),
]);

/** Most model calls in one reply when it uses tools (load, run, check, fetch…). */
const MAX_TOOL_STEPS = 12;
/** Most images the model may make itself in one reply. */
const MAX_IMAGES_PER_REPLY = 2;

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

  const resuming = "resume" in body ? body.resume : null;
  const cap = capFor(user.id);
  if (!resuming && cap !== null && sentToday(user.id) >= cap) return Response.json({ error: "daily_cap", cap }, { status: 429 });

  let conversation = body.conversationId ? getConversation(user.id, body.conversationId) : undefined;
  if (body.conversationId && !conversation) return Response.json({ error: "not_found" }, { status: 404 });
  const paused = resuming ? pendingApproval(user.id, resuming.toolCallId) : undefined;
  if (resuming && (!paused || paused.conversation_id !== conversation?.id)) return Response.json({ error: "not_found" }, { status: 404 });

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
  // Connected tools (MCP): models that can call tools get a short catalogue and load what they need.
  const imageCommand = asked ? /^\/image(?:\s+([\s\S]*))?$/.exec(asked) : null;
  const toolset = toolsetFor(isAdmin, conversation?.id ?? null);
  const useTools = !imageCommand && !!model.tools;
  const system =
    systemPrompt({
      base: getMasterPrompt().text,
      instructions: getInstructions(user.id),
      project: project ? { name: project.name, instructions: project.instructions } : null,
      skills,
      files,
    }) + (useTools && toolset.catalogue ? `\n\n${toolset.catalogue}` : "");
  if (estimateTokens([{ role: "system", content: system }]) > model.contextTokens - MAX_REPLY_TOKENS - MIN_CONVERSATION_TOKENS) {
    return Response.json({ error: "files_too_big", model: model.label }, { status: 413 });
  }

  // Images: "/image <description>" makes one directly; otherwise models that can call tools may make
  // one themselves. Both need image access and allowance left today.
  const imagePrompt = imageCommand?.[1]?.trim().slice(0, MAX_IMAGE_PROMPT_CHARS) ?? "";
  const imageModel = allowedImageModel(body.image?.model, isAdmin)?.id ?? DEFAULT_IMAGE_MODEL;
  const imageAspect: ImageAspect = body.image?.aspect ?? "square";
  if (imageCommand) {
    if (!imagePrompt) return Response.json({ error: "bad_request" }, { status: 400 });
    if (!hasImageAccess(user.id)) return Response.json({ error: "images_disabled" }, { status: 403 });
    if (!canMakeImage(user.id)) return Response.json({ error: "image_cap", cap: imageCapFor(user.id) }, { status: 429 });
  }
  const offerImageTool = useTools && canMakeImage(user.id);

  // Pictures attached to the message: only for models that can see them, and only ones just uploaded.
  const attachedImageIds = "content" in body ? (body.imageIds ?? []) : [];
  if (attachedImageIds.length) {
    if (!model.vision) return Response.json({ error: "no_vision", model: model.label }, { status: 400 });
    if (!unsentUploads(user.id, attachedImageIds)) return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // Save the user's side first, so it's kept even if the model never answers.
  let userMessageId: number | null = null;
  const conversationId = transaction(() => {
    const id = conversation?.id ?? createConversation(user.id, requestedModel?.id ?? DEFAULT_MODEL, project?.id ?? null);
    if (conversation && requestedModel && requestedModel.id !== conversation.model) {
      setConversationModel(user.id, id, requestedModel.id);
    }
    if ("regenerate" in body) dropLastAssistant(id);
    else if ("content" in body) {
      userMessageId = addMessage(id, "user", body.content);
      if (attachedImageIds.length) claimUploads(user.id, attachedImageIds, id, userMessageId);
    }
    if (!resuming) recordSend(user.id);
    return id;
  });
  conversation = getConversation(user.id, conversationId)!;
  if (newFileIds.length) setAttachedFiles(user.id, conversationId, newFileIds);
  if (newSkillIds.length) setPinnedSkills(user.id, { conversationId }, newSkillIds);

  // Image-only replies have no text to send; the images themselves are listed in the system prompt.
  // Pictures the person attached go with their messages: the latest few to models that can see them,
  // otherwise a note that they're there.
  const sentImages = model.vision ? await imagesForPrompt(user.id, conversationId) : new Map<number, string[]>();
  const pictureCounts = uploadCounts(user.id, conversationId);
  const history = listMessages(user.id, conversationId)
    .map<ChatTurn>((m) => {
      if (m.role === "assistant") return { role: m.role, content: stripImageNotes(m.content) };
      const images = sentImages.get(m.id);
      if (images) return { role: m.role, content: m.content, images };
      const count = pictureCounts.get(m.id);
      const note = count
        ? `[The person attached ${count === 1 ? "a picture" : `${count} pictures`} here, which ${model.vision ? "is no longer shown to you" : "this model can't see"}.]`
        : "";
      return { role: m.role, content: [m.content, note].filter(Boolean).join("\n\n") };
    })
    .filter((m) => m.role !== "assistant" || m.content);
  if (!resuming && history.at(-1)?.role !== "user") return Response.json({ error: "nothing_to_answer" }, { status: 400 });

  // The model can't see images, so ones it already made are described in the system prompt.
  const madeImages = listImages(user.id, conversationId)
    .filter((i) => i.status === "ready" && i.messageId !== null)
    .slice(-10)
    .map((i) => i.prompt.slice(0, 300));
  const prompt = buildPrompt(madeImages.length ? `${system}${imagesNote(madeImages)}` : system, history, model);
  const needsTitle = !conversation.title && !resuming;
  const firstUserMessage = history.find((m) => m.role === "user")!.content || "(a picture)";

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
      const toolCallIds: number[] = [];
      let imagesMade = 0;
      // Set after a tool step: the next text starts a new paragraph.
      let breakBeforeText = false;
      const onToolUpdate = (call: ClientToolCall) => send({ type: "tool", call });
      const showMedia = (media: ClientImage[]) => {
        for (const m of media) {
          imageIds.push(m.id);
          send({ type: "image", image: m });
        }
      };

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
              if (breakBeforeText && reply.trim()) {
                reply += "\n\n";
                send({ type: "delta", text: "\n\n" });
              }
              breakBeforeText = false;
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
          let messages = prompt;
          const loaded = [...toolset.loaded];
          // An approved call that failed before doing anything (e.g. a wrong argument) may be retried once
          // without asking again; a successful run uses the approval up.
          let retryGrant: string | null = null;

          // Carrying on after an approval card: run (or skip) the paused call and hand the model its result.
          if (resuming && paused) {
            const args = JSON.parse(paused.args) as Record<string, unknown>;
            const tool = toolset.available.find((t) => t.qualified === paused.qualified);
            let result: string;
            if (resuming.decision === "decline") result = declineToolCall(paused.id, onToolUpdate);
            else if (!tool) result = declineToolCall(paused.id, onToolUpdate) + " (That tool is no longer available.)";
            else {
              const out = await runToolCall({ userId: user.id, conversationId, tool, args, approved: paused.id, onUpdate: onToolUpdate });
              showMedia(out.media);
              result = out.result;
              if (out.call.status === "failed") retryGrant = paused.qualified;
            }
            messages = [
              ...messages,
              { role: "assistant", content: "", tool_calls: [{ function: { name: paused.qualified, arguments: args } }] },
              { role: "tool", content: result, tool_name: paused.qualified },
            ];
          }

          /** What the model may call this step. */
          const offered = (): ToolDef[] | undefined => {
            if (!useTools) return undefined;
            const list = [
              ...(offerImageTool && imagesMade < MAX_IMAGES_PER_REPLY && canMakeImage(user.id) ? [IMAGE_TOOL] : []),
              ...(toolset.available.length ? [LOAD_TOOLS] : []),
              ...loaded,
            ];
            return list.length ? list : undefined;
          };

          for (let step = 0; step < MAX_TOOL_STEPS; step++) {
            const before = reply.length;
            const calls = await streamTurn(messages, offered());
            if (!calls.length || req.signal.aborted) break;
            const stepText = reply.slice(before).trim();
            const handled = calls.slice(0, 4);
            const results: ChatTurn[] = [];
            let waiting = false;
            for (const call of handled) {
              const name = call.function.name;
              const args = (call.function.arguments ?? {}) as Record<string, unknown>;
              let result: string;
              if (name === "generate_image") {
                const description = String(args.prompt ?? "").trim().slice(0, MAX_IMAGE_PROMPT_CHARS);
                if (!description) result = "No image made: the description was empty.";
                else if (!canMakeImage(user.id) || imagesMade >= MAX_IMAGES_PER_REPLY) result = "No image made: the limit for now is reached. Tell the person kindly.";
                else {
                  imagesMade++;
                  const made = await makeImage(description, isImageAspect(args.aspect) ? args.aspect : imageAspect);
                  result =
                    made.status === "ready"
                      ? `Done: the image is now shown to the person (prompt used: "${description}"). You can't see it, so don't describe details as if you could — briefly say what you made and offer to adjust it.`
                      : "The image couldn't be made this time. Apologise briefly and suggest trying again.";
                }
              } else if (name === "load_tools") {
                const r = loadTools(conversationId, toolset.available, args.names);
                for (const d of r.defs) if (!loaded.some((x) => x.function.name === d.function.name)) loaded.push(d);
                result = r.result;
              } else {
                const tool = toolset.available.find((t) => t.qualified === name);
                if (!tool) result = `There's no tool called ${name} available. Check the catalogue and use load_tools first.`;
                else {
                  // Called straight from the catalogue without loading: allow it, and keep it loaded.
                  if (!loaded.some((d) => d.function.name === tool.qualified)) {
                    loaded.push(...loadTools(conversationId, toolset.available, [tool.qualified]).defs);
                  }
                  const preApproved = retryGrant === tool.qualified;
                  if (preApproved) retryGrant = null;
                  const out = await runToolCall({ userId: user.id, conversationId, tool, args, preApproved, onUpdate: onToolUpdate });
                  if (preApproved && out.call.status === "failed") retryGrant = null;
                  toolCallIds.push(out.call.id);
                  showMedia(out.media);
                  result = out.result;
                  if (out.paused) waiting = true;
                }
              }
              results.push({ role: "tool", content: result, tool_name: name });
            }
            messages = [...messages, { role: "assistant", content: stepText, tool_calls: handled }, ...results];
            breakBeforeText = true;
            // Paused for approval: stop here; the browser carries on when the person decides.
            if (waiting) break;
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
        if (reply.trim() || imageIds.length || toolCallIds.length) {
          messageId = addMessage(conversationId, "assistant", stripImageNotes(reply), thinking ? { text: thinking, ms: thinkingMs } : null);
          attachImagesToMessage(imageIds, messageId);
          attachToolCallsToMessage(toolCallIds, messageId);
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
