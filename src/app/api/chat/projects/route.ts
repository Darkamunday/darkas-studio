import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { countProjects, createProject, listProjects, toClientProject } from "@/lib/chat/projects";
import { MAX_PROJECTS_PER_USER, allowedModel } from "@/config/chat";
import { ProjectFields } from "./schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ projects: listProjects(auth.user.id).map((p) => toClientProject(auth.user.id, p)) });
}

export async function POST(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = ProjectFields.required({ name: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (countProjects(auth.user.id) >= MAX_PROJECTS_PER_USER) return Response.json({ error: "too_many_projects" }, { status: 400 });
  // A model this person can't use (or one that's gone) is just no preference.
  const model = parsed.data.model ? (allowedModel(parsed.data.model, !!auth.user.is_admin)?.id ?? null) : parsed.data.model;
  const project = createProject(auth.user.id, { ...parsed.data, model });
  return Response.json({ project: toClientProject(auth.user.id, project) });
}
