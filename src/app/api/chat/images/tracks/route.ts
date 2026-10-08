import { requireChatApi } from "@/lib/chat/access";
import { ownTracks } from "@/lib/chat/images";

export const dynamic = "force-dynamic";

/** Your songs, for picking which one gets an image as its cover. */
export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ tracks: ownTracks(auth.user.id) });
}
