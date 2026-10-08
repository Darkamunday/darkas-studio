import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { deleteProject, getProject, toClientProject, updateProject } from "@/lib/chat/projects";
import { allowedModel } from "@/config/chat";
import { ProjectFields } from "../schema";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/chat/projects/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = ProjectFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const id = Number((await ctx.params).id);
  const model = parsed.data.model ? (allowedModel(parsed.data.model, !!auth.user.is_admin)?.id ?? null) : parsed.data.model;
  if (!updateProject(auth.user.id, id, { ...parsed.data, model })) return notFound();
  return Response.json({ project: toClientProject(auth.user.id, getProject(auth.user.id, id)!) });
}

/** Delete a project; its chats move back to the main list. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chat/projects/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  if (!deleteProject(auth.user.id, Number((await ctx.params).id))) return notFound();
  return Response.json({ ok: true });
}
