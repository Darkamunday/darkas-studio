import { requireChatApi } from "@/lib/chat/access";
import { confirmAdult } from "@/lib/chat/adult";

export const dynamic = "force-dynamic";

/** Confirm you're 18+ (once), to use adult chats — only after an admin has switched them on for you. */
export async function POST() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  if (!confirmAdult(auth.user.id)) return Response.json({ error: "adult_disabled" }, { status: 403 });
  return Response.json({ ok: true });
}
