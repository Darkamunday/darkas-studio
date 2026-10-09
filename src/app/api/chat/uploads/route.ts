import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { UploadError, saveUpload } from "@/lib/chat/uploads";
import { MAX_UPLOAD_BYTES } from "@/config/chat";

export const dynamic = "force-dynamic";

/** Upload a picture to attach to your next message (multipart field "file"). */
export async function POST(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "bad_request" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "file_too_big" }, { status: 413 });
  try {
    return Response.json({ upload: await saveUpload(auth.user.id, Buffer.from(await file.arrayBuffer())) });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.reason }, { status: err.reason === "file_too_big" ? 413 : 400 });
    throw err;
  }
}
