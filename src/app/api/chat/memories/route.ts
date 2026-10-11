import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { addMemory, deleteAllMemories, listMemories, memoryOnForApp, memoryOnForUser, setMemoryForUser } from "@/lib/chat/memory";
import { MAX_MEMORY_CHARS } from "@/config/chat";

export const dynamic = "force-dynamic";

const state = (userId: number) => ({ memories: listMemories(userId), enabled: memoryOnForUser(userId), available: memoryOnForApp() });

export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json(state(auth.user.id));
}

/** Add a memory yourself. */
export async function POST(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = z.object({ content: z.string().trim().min(1).max(MAX_MEMORY_CHARS) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const added = addMemory(auth.user.id, parsed.data.content, "person");
  if (!added.ok) return Response.json({ error: added.reason }, { status: 400 });
  return Response.json({ memory: added.memory });
}

/** Switch "Use memory" on or off for yourself. */
export async function PUT(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  setMemoryForUser(auth.user.id, parsed.data.enabled);
  return Response.json(state(auth.user.id));
}

/** Forget everything. */
export async function DELETE() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  deleteAllMemories(auth.user.id);
  return Response.json(state(auth.user.id));
}
