import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { capFor, hasChatAccess, sentToday } from "@/lib/chat/access";
import { cookies } from "next/headers";
import { CHAT_MODEL_COOKIE, CHAT_THINK_COOKIE, DEFAULT_MODEL, allowedModel } from "@/config/chat";
import { getConversation, getInstructions, listConversations, listMessages } from "@/lib/chat/store";
import { attachedFileIds, listFiles, toClientFile } from "@/lib/chat/files";
import { getProject, listProjects, toClientProject } from "@/lib/chat/projects";
import { conversationSkillIds, listSkills, toClientSkill } from "@/lib/chat/skills";
import { hasImageAccess, listImages } from "@/lib/chat/images";
import { pinnedReplyIds } from "@/lib/chat/shared";
import { listToolCalls } from "@/lib/chat/tools";
import { DEFAULT_IMAGE_MODEL, IMAGE_PREFS_COOKIE, allowedImageModel, isImageAspect } from "@/config/images";
import { getI18n } from "@/lib/i18n/server";
import { card } from "@/components/ui";
import { ChatApp } from "../chat-app";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.chat };
}

// /chat is a new chat (in a project with ?project=<id>); /chat/<id> opens one of yours.
export default async function ChatPage({ params, searchParams }: PageProps<"/chat/[[...id]]">) {
  const user = await requireUser();
  const { m } = await getI18n();

  if (!hasChatAccess(user)) {
    return (
      <div className="grid flex-1 place-items-center p-4">
        <div className={`${card} max-w-lg p-8 text-center`}>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-pink/12 text-2xl" aria-hidden>
            💬
          </div>
          <h1 className="text-2xl font-semibold">{m.chat.offHeading}</h1>
          <p className="mt-3 text-muted">{m.chat.offText}</p>
        </div>
      </div>
    );
  }

  const segments = (await params).id;
  let id: number | null = null;
  const isAdmin = !!user.is_admin;
  const jar = await cookies();
  // New chats start on the model this browser picked last, if it's still offered to this person.
  let model = allowedModel(jar.get(CHAT_MODEL_COOKIE)?.value, isAdmin)?.id ?? DEFAULT_MODEL;
  let think = jar.get(CHAT_THINK_COOKIE)?.value !== "0";
  let projectId: number | null = null;
  if (segments) {
    id = Number(segments[0]);
    const conversation = segments.length === 1 && Number.isInteger(id) ? getConversation(user.id, id) : undefined;
    if (!conversation) redirect("/chat");
    // A model since removed from the config, or now admin-only, shows (and is answered by) the default.
    model = allowedModel(conversation.model, isAdmin)?.id ?? DEFAULT_MODEL;
    projectId = conversation.project_id;
  } else {
    // A new chat in a project starts on the project's model and Think setting, where it has them.
    const raw = (await searchParams).project;
    const project = getProject(user.id, Number(Array.isArray(raw) ? raw[0] : raw));
    if (raw && !project) redirect("/chat");
    if (project) {
      projectId = project.id;
      model = allowedModel(project.model, isAdmin)?.id ?? model;
      if (project.think !== null) think = !!project.think;
    }
  }

  const conversations = listConversations(user.id).map(({ id, title, updated_at, project_id }) => ({
    id,
    title,
    updated_at,
    project_id,
  }));
  const images = id ? listImages(user.id, id) : [];
  const toolCalls = id ? listToolCalls(user.id, id) : [];
  const messages = id
    ? listMessages(user.id, id)
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          key: `m${msg.id}`,
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          thinking: msg.thinking ?? undefined,
          thinkingMs: msg.thinking_ms,
          images: images.filter((img) => img.messageId === msg.id),
          tools: toolCalls.filter((t) => t.messageId === msg.id),
        }))
    : [];

  return (
    <ChatApp
      key={`${id ?? "new"}-${projectId ?? ""}`}
      initialConversations={conversations}
      initialId={id}
      initialMessages={messages}
      initialModel={model}
      initialUsage={{ sent: sentToday(user.id), cap: capFor(user.id) }}
      initialInstructions={getInstructions(user.id) ?? ""}
      initialThink={think}
      initialFiles={listFiles(user.id).map(toClientFile)}
      initialAttached={id ? attachedFileIds(user.id, id) : []}
      initialProjects={listProjects(user.id).map((p) => toClientProject(user.id, p))}
      projectId={projectId}
      initialSkills={listSkills(user.id).map(toClientSkill)}
      initialPinnedSkills={id ? conversationSkillIds(user.id, id) : []}
      initialPinnedReplies={id ? pinnedReplyIds(user.id, id) : []}
      imageAccess={hasImageAccess(user.id)}
      initialImagePrefs={imagePrefs(jar.get(IMAGE_PREFS_COOKIE)?.value, isAdmin)}
      isAdmin={isAdmin}
    />
  );
}

/** The image settings this browser picked last (model checked against what this person may use). */
function imagePrefs(raw: string | undefined, isAdmin: boolean) {
  let saved: { model?: unknown; aspect?: unknown; improve?: unknown } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {}
  return {
    model: allowedImageModel(saved.model, isAdmin)?.id ?? DEFAULT_IMAGE_MODEL,
    aspect: isImageAspect(saved.aspect) ? saved.aspect : ("square" as const),
    improve: saved.improve === true,
  };
}
