import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { capFor, hasChatAccess, sentToday } from "@/lib/chat/access";
import { cookies } from "next/headers";
import { CHAT_MODEL_COOKIE, CHAT_THINK_COOKIE, DEFAULT_MODEL, allowedModel } from "@/config/chat";
import { getConversation, getInstructions, listConversations, listMessages } from "@/lib/chat/store";
import { attachedFileIds, listFiles, toClientFile } from "@/lib/chat/files";
import { getI18n } from "@/lib/i18n/server";
import { card } from "@/components/ui";
import { ChatApp } from "../chat-app";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.chat };
}

// /chat is a new chat; /chat/<id> opens one of yours.
export default async function ChatPage({ params }: PageProps<"/chat/[[...id]]">) {
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
  if (segments) {
    id = Number(segments[0]);
    const conversation = segments.length === 1 && Number.isInteger(id) ? getConversation(user.id, id) : undefined;
    if (!conversation) redirect("/chat");
    // A model since removed from the config, or now admin-only, shows (and is answered by) the default.
    model = allowedModel(conversation.model, isAdmin)?.id ?? DEFAULT_MODEL;
  }

  const conversations = listConversations(user.id).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
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
        }))
    : [];

  return (
    <ChatApp
      key={id ?? "new"}
      initialConversations={conversations}
      initialId={id}
      initialMessages={messages}
      initialModel={model}
      initialUsage={{ sent: sentToday(user.id), cap: capFor(user.id) }}
      initialInstructions={getInstructions(user.id) ?? ""}
      initialThink={jar.get(CHAT_THINK_COOKIE)?.value !== "0"}
      initialFiles={listFiles(user.id).map(toClientFile)}
      initialAttached={id ? attachedFileIds(user.id, id) : []}
      isAdmin={isAdmin}
    />
  );
}
