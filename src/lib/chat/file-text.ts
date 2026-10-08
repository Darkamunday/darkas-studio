import "server-only";

// Pulls plain text out of an uploaded file for the chat's reference files.

export const FILE_TYPES = [".txt", ".md", ".markdown", ".pdf", ".docx"] as const;

export class FileTextError extends Error {
  constructor(public reason: "file_type" | "no_text" | "file_unreadable") {
    super(reason);
  }
}

const extOf = (name: string) => name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";

/** Tidy extracted text: no NULs, Windows line endings or runs of blank lines. */
function tidy(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(name: string, data: Buffer): Promise<string> {
  const ext = extOf(name);
  let text: string;
  try {
    if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
      text = new TextDecoder("utf-8").decode(data);
    } else if (ext === ".pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      text = (await pdfText(pdf, { mergePages: true })).text;
    } else if (ext === ".docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: data })).value;
    } else {
      throw new FileTextError("file_type");
    }
  } catch (err) {
    if (err instanceof FileTextError) throw err;
    console.error(`[chat files] couldn't read ${name}`, err);
    throw new FileTextError("file_unreadable");
  }
  const clean = tidy(text);
  // Scanned PDFs are pictures of text: nothing to extract.
  if (!clean) throw new FileTextError("no_text");
  return clean;
}

export function isAllowedFile(name: string): boolean {
  return (FILE_TYPES as readonly string[]).includes(extOf(name));
}
