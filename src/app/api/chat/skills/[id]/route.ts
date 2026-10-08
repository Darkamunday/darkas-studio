import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { canEditSkill, deleteSkill, getSkill, slugTaken, toClientSkill, updateSkill } from "@/lib/chat/skills";
import { SkillFields } from "../schema";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

/** Edit a skill: your own, or (admins) a shared one. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/chat/skills/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const skill = getSkill(auth.user.id, Number((await ctx.params).id));
  if (!skill) return notFound();
  if (!canEditSkill(auth.user, skill)) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = SkillFields.omit({ shared: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (slugTaken(auth.user.id, parsed.data.slug, skill.id)) return Response.json({ error: "slug_taken" }, { status: 409 });
  updateSkill(skill.id, parsed.data);
  return Response.json({ skill: toClientSkill(getSkill(auth.user.id, skill.id)!) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chat/skills/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const skill = getSkill(auth.user.id, Number((await ctx.params).id));
  if (!skill) return notFound();
  if (!canEditSkill(auth.user, skill)) return Response.json({ error: "forbidden" }, { status: 403 });
  deleteSkill(skill.id);
  return Response.json({ ok: true });
}
