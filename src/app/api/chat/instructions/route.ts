import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { getInstructions, setInstructions } from "@/lib/chat/store";
import { MAX_INSTRUCTIONS_CHARS } from "@/config/chat";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ instructions: getInstructions(auth.user.id) ?? "" });
}

const Body = z.object({ instructions: z.string().max(MAX_INSTRUCTIONS_CHARS) });

export async function PUT(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  setInstructions(auth.user.id, parsed.data.instructions);
  return Response.json({ instructions: getInstructions(auth.user.id) ?? "" });
}
