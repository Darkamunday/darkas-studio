import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { hasChatAccess } from "@/lib/chat/access";
import { getI18n } from "@/lib/i18n/server";
import { card } from "@/components/ui";
import { ChatBox } from "./chat-box";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.chat };
}

export default async function ChatPage() {
  const user = await requireUser();
  const { m } = await getI18n();

  if (!hasChatAccess(user)) {
    return (
      <div className={`${card} mx-auto max-w-lg p-8 text-center`}>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-pink/12 text-2xl" aria-hidden>
          💬
        </div>
        <h1 className="text-2xl font-semibold">{m.chat.offHeading}</h1>
        <p className="mt-3 text-muted">{m.chat.offText}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-semibold sm:text-5xl">{m.chat.heading}</h1>
        <p className="mt-3 text-muted">{m.chat.blurb}</p>
      </div>
      <ChatBox />
    </div>
  );
}
