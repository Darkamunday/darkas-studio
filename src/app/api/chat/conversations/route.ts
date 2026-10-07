import { requireChatApi } from "@/lib/chat/access";
import { listConversations } from "@/lib/chat/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ conversations: listConversations(auth.user.id) });
}
