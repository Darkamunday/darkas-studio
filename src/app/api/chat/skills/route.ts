import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { countOwnSkills, createSkill, listSkills, slugTaken, toClientSkill } from "@/lib/chat/skills";
import { MAX_SKILLS_PER_USER } from "@/config/chat";
import { SkillFields } from "./schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ skills: listSkills(auth.user.id).map(toClientSkill) });
}

export async function POST(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = SkillFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { shared, ...input } = parsed.data;
  if (shared && !auth.user.is_admin) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!shared && countOwnSkills(auth.user.id) >= MAX_SKILLS_PER_USER) return Response.json({ error: "too_many_skills" }, { status: 400 });
  if (slugTaken(auth.user.id, input.slug)) return Response.json({ error: "slug_taken" }, { status: 409 });
  return Response.json({ skill: toClientSkill(createSkill(shared ? null : auth.user.id, input)) });
}
