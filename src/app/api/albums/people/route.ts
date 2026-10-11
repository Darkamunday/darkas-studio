import { getCurrentUser } from "@/lib/auth";
import { albumPeople } from "@/lib/albums";

export const dynamic = "force-dynamic";

/** People an album can be shared with. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ people: albumPeople(user.id) });
}
