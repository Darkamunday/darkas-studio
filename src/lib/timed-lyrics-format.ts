// Shared by server and client: turn the provider's timed words into lines and LRC files.

export type TimedWord = { word: string; startS: number; endS: number };

export type TimedLine =
  | { kind: "section"; label: string; startS: number }
  | { kind: "line"; text: string; startS: number; endS: number; words: TimedWord[] }
  | { kind: "gap" };

/**
 * Words carry the lyrics' own layout: "[Chorus]\nLa " starts a section, "on.\n" ends a line,
 * "on.\n\n" ends a verse. Rebuild that layout with each line's start/end time.
 */
export function toLines(words: TimedWord[]): TimedLine[] {
  const lines: TimedLine[] = [];
  let current: TimedWord[] = [];

  const flush = () => {
    const text = current.map((w) => w.word).join("").trim();
    if (text) lines.push({ kind: "line", text, startS: current[0].startS, endS: current[current.length - 1].endS, words: current });
    current = [];
  };

  for (const w of words) {
    // Split one provider word on its line breaks, e.g. "[Intro]\nI " → "[Intro]", "I ".
    const parts = w.word.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        flush();
        if (part === "" && i < parts.length - 1 && lines.at(-1)?.kind === "line") lines.push({ kind: "gap" });
      }
      const tag = /^\s*\[(.+?)\]\s*$/.exec(part);
      if (tag) {
        flush();
        if (lines.at(-1)?.kind === "line") lines.push({ kind: "gap" });
        lines.push({ kind: "section", label: tag[1], startS: w.startS });
      } else if (part) {
        current.push({ word: part, startS: w.startS, endS: w.endS });
      }
    });
  }
  flush();
  while (lines.at(-1)?.kind === "gap") lines.pop();
  return lines;
}

/** 83.456 → "01:23.45" (LRC's mm:ss.xx). */
export function lrcTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  const mm = Math.floor(cs / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Standard LRC: one "[mm:ss.xx]line" per sung line, which most players and lyric-video tools read. */
export function toLrc(lines: TimedLine[], meta: { title: string; artist: string; durationS?: number | null }): string {
  const head = [`[ti:${meta.title}]`, `[ar:${meta.artist}]`, "[by:Darka's Studio]"];
  if (meta.durationS) head.push(`[length:${lrcTime(meta.durationS).slice(0, 5)}]`);
  const body = lines.flatMap((l) => (l.kind === "line" ? [`[${lrcTime(l.startS)}]${l.text}`] : []));
  return [...head, "", ...body, ""].join("\n");
}
