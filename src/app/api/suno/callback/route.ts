import type { NextRequest } from "next/server";
import { getGenerationByTask, refreshGeneration } from "@/lib/tracks";

// sunoapi.org calls this at the text / first / complete stages. The payload is
// unauthenticated, so we only use it as a nudge: the task is re-fetched from
// the API with our key rather than trusting anything in the body.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { data?: { task_id?: string; taskId?: string } } | null;
  const taskId = body?.data?.task_id ?? body?.data?.taskId;
  const gen = taskId ? getGenerationByTask(taskId) : undefined;
  if (gen) void refreshGeneration(gen.id, { force: true });
  return Response.json({ ok: true });
}
