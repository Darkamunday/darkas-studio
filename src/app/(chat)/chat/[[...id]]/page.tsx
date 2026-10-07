import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasChatAccess } from "@/lib/chat/access";
import { getConversation, listConversations, listMessages } from "@/lib/chat/store";
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
  if (segments) {
    id = Number(segments[0]);
    if (segments.length > 1 || !Number.isInteger(id) || !getConversation(user.id, id)) redirect("/chat");
  }

  const conversations = listConversations(user.id).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
  const messages = id
    ? listMessages(user.id, id)
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({ key: `m${msg.id}`, id: msg.id, role: msg.role as "user" | "assistant", content: msg.content }))
    : [];

  return <ChatApp key={id ?? "new"} initialConversations={conversations} initialId={id} initialMessages={messages} />;
}
