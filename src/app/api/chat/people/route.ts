import { requireChatApi } from "@/lib/chat/access";
import { shareablePeople } from "@/lib/chat/projects";

export const dynamic = "force-dynamic";

/** People a project can be shared with (everyone else who has chat). */
export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ people: shareablePeople(auth.user.id) });
}
