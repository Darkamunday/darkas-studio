import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasChatAccess } from "@/lib/chat/access";
import { getProject, toClientProject } from "@/lib/chat/projects";
import { listShared } from "@/lib/chat/shared";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/format";
import { SharedGrid } from "./shared-grid";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.chat.sharedTab };
}

// /chat/projects/<id>: the project's Shared tab — what people have made in its chats.
export default async function SharedPage({ params }: PageProps<"/chat/projects/[id]">) {
  const user = await requireUser();
  if (!hasChatAccess(user)) redirect("/chat");
  const { m } = await getI18n();
  const id = Number((await params).id);
  const project = getProject(user.id, id);
  const items = project ? listShared(user.id, id) : undefined;
  if (!project || !items) redirect("/chat");
  const p = toClientProject(user.id, project);
  const people = p.mine ? (p.everyone ? m.chat.sharedWithEveryone : fmt(m.chat.sharedWithCount, { n: String(p.members.length) })) : fmt(p.everyone ? m.chat.sharedWithEveryoneBy : m.chat.sharedBy, { name: p.owner ?? "" });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
        <Link href={`/chat?project=${p.id}`} className="inline-flex items-center gap-1.5 text-sm text-subtle transition hover:text-fg">
          <span aria-hidden>←</span> {fmt(m.chat.backToProject, { name: p.name })}
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <span aria-hidden className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-pink/25 to-violet/25 text-xl">
            {p.emoji}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">
              {p.name} · <span className="text-brand">{m.chat.sharedTab}</span>
            </h1>
            <p className="text-sm text-subtle">{people}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted">{m.chat.sharedTabBlurb}</p>
        <SharedGrid projectId={p.id} initialItems={items} />
      </div>
    </div>
  );
}
