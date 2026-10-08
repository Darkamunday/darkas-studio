import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { addFile, countFiles, listFiles, toClientFile } from "@/lib/chat/files";
import { FileTextError, extractText, isAllowedFile } from "@/lib/chat/file-text";
import { MAX_FILE_BYTES, MAX_FILE_CHARS, MAX_FILES_PER_USER } from "@/config/chat";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ files: listFiles(auth.user.id).map(toClientFile) });
}

/** Upload one file (multipart field "file"); its text is extracted and kept. */
export async function POST(req: NextRequest) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const fail = (error: string, status = 400) => Response.json({ error }, { status });

  if (countFiles(auth.user.id) >= MAX_FILES_PER_USER) return fail("too_many_files");
  const form = await req.formData().catch(() => null);
  const upload = form?.get("file");
  if (!(upload instanceof File)) return fail("bad_request");
  const name = upload.name.replace(/[\r\n]/g, " ").trim().slice(0, 200) || "file";
  if (!isAllowedFile(name)) return fail("file_type");
  if (upload.size > MAX_FILE_BYTES) return fail("file_too_big", 413);

  try {
    const text = await extractText(name, Buffer.from(await upload.arrayBuffer()));
    if (text.length > MAX_FILE_CHARS) return fail("file_too_long", 413);
    return Response.json({ file: toClientFile(addFile(auth.user.id, name, upload.size, text)) });
  } catch (err) {
    if (err instanceof FileTextError) return fail(err.reason, 422);
    throw err;
  }
}
