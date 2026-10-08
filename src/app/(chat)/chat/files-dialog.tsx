"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import type { ClientFile } from "@/lib/chat/files";

/**
 * The person's reference files: upload, tick which ones this chat uses, switch "always" on, read the
 * extracted text, delete. Shows how much of the model's window the chat's files take up.
 */
export function FilesDialog({
  files,
  attached,
  projectFiles,
  modelLabel,
  windowTokens,
  onFilesChange,
  onToggleAttach,
  onClose,
}: {
  files: ClientFile[];
  attached: Set<number>;
  /** Files the chat's project brings in (always included; managed in the project's settings). */
  projectFiles: Set<number>;
  modelLabel: string;
  /** How many file tokens fit in the model's window alongside a short conversation. */
  windowTokens: number;
  onFilesChange: (files: ClientFile[]) => void;
  onToggleAttach: (id: number) => void;
  onClose: () => void;
}) {
  const { locale, m } = useI18n();
  const num = new Intl.NumberFormat(locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const errorText = (reason: string) => (m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.generic;

  async function upload(list: FileList | File[]) {
    setError(null);
    let current = files;
    for (const file of Array.from(list)) {
      setUploading(file.name);
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/chat/files", { method: "POST", body: form }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { file?: ClientFile; error?: string } | null;
      if (res?.ok && body?.file) {
        current = [...current, body.file].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        onFilesChange(current);
        onToggleAttach(body.file.id); // a fresh upload is meant for the chat you're in
      } else {
        // 413 from a proxy in front of the app has no JSON body.
        setError(`${file.name}: ${errorText(body?.error ?? (res?.status === 413 ? "file_too_big" : "generic"))}`);
      }
    }
    setUploading(null);
  }

  async function setAlways(file: ClientFile, always: boolean) {
    // Flip it straight away; put it back if the save fails.
    const set = (value: boolean) => onFilesChange(files.map((f) => (f.id === file.id ? { ...f, always: value } : f)));
    set(always);
    const res = await fetch(`/api/chat/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ always }),
    }).catch(() => null);
    if (!res?.ok) {
      set(!always);
      setError(errorText("generic"));
    }
  }

  async function remove(file: ClientFile) {
    if (!window.confirm(fmt(m.chat.deleteFileConfirm, { name: file.name }))) return;
    const res = await fetch(`/api/chat/files/${file.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) return setError(errorText("generic"));
    onFilesChange(files.filter((f) => f.id !== file.id));
    if (viewing?.id === file.id) setViewing(null);
  }

  async function toggleView(file: ClientFile) {
    if (viewing?.id === file.id) return setViewing(null);
    const res = await fetch(`/api/chat/files/${file.id}`);
    const body = (await res.json().catch(() => null)) as { text?: string } | null;
    if (res.ok && body?.text !== undefined) setViewing({ id: file.id, text: body.text });
    else setError(errorText("generic"));
  }

  const used = files.filter((f) => f.always || attached.has(f.id) || projectFiles.has(f.id)).reduce((n, f) => n + f.tokens, 0);
  const over = used > windowTokens;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="files-title">
      <button type="button" aria-label={m.chat.filesDone} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <div className="relative flex max-h-[90dvh] w-full max-w-xl animate-pop flex-col rounded-t-3xl border border-line bg-surface shadow-card sm:rounded-3xl">
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-pink/25 to-violet/25">
              <PaperclipIcon className="h-4 w-4" />
            </span>
            <h2 id="files-title" className="text-lg font-semibold">{m.chat.filesTitle}</h2>
          </div>
          <p className="mt-3 text-sm text-muted">{m.chat.filesBlurb}</p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
            }}
            disabled={uploading !== null}
            className={`mt-4 flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition ${
              dragging ? "border-pink bg-pink/8" : "border-line hover:border-line-strong hover:bg-surface-2"
            } disabled:cursor-wait`}
          >
            <span className="text-sm font-medium text-fg">
              {uploading ? fmt(m.chat.uploadingFile, { name: uploading }) : m.chat.dropFiles}
            </span>
            <span className="text-xs text-subtle">{m.chat.fileTypesHint}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            aria-label={m.chat.dropFiles}
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-4">
          {files.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">{m.chat.noFiles}</p>
          ) : (
            <ul className="divide-y divide-line">
              {files.map((f) => (
                <li key={f.id} className="py-2.5">
                  <div className="flex items-center gap-3 px-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3" title={m.chat.useInChat}>
                      <input
                        type="checkbox"
                        checked={f.always || attached.has(f.id) || projectFiles.has(f.id)}
                        disabled={f.always || projectFiles.has(f.id)}
                        onChange={() => onToggleAttach(f.id)}
                        aria-label={`${m.chat.useInChat}: ${f.name}`}
                        className="h-4 w-4 flex-none accent-[var(--pink)]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{f.name}</span>
                        <span className="text-xs text-subtle">
                          {fmt(m.chat.fileTokens, { n: num.format(f.tokens) })}
                          {projectFiles.has(f.id) && (
                            <span className="ml-1.5 rounded-full bg-pink/12 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent-fg">
                              {m.chat.projectTag}
                            </span>
                          )}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted" title={m.chat.alwaysHint}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={f.always}
                        onChange={(e) => void setAlways(f, e.target.checked)}
                        aria-label={`${m.chat.alwaysHint}: ${f.name}`}
                        className="h-3.5 w-3.5 accent-[var(--violet)]"
                      />
                      {m.chat.alwaysOn}
                    </label>
                    <button
                      type="button"
                      onClick={() => void toggleView(f)}
                      aria-expanded={viewing?.id === f.id}
                      className="rounded-lg px-2 py-1 text-xs text-subtle transition hover:bg-surface-2 hover:text-fg"
                    >
                      {viewing?.id === f.id ? m.chat.hideFile : m.chat.viewFile}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(f)}
                      aria-label={`${m.chat.deleteFile}: ${f.name}`}
                      title={m.chat.deleteFile}
                      className="grid h-7 w-7 place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-danger"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                  {viewing?.id === f.id && (
                    <pre className="mx-2 mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3 font-sans text-xs leading-relaxed text-muted">
                      {viewing.text}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <p className={`flex-1 text-xs ${over ? "text-danger" : "text-subtle"}`}>
            {over
              ? fmt(m.chat.filesOver, { model: modelLabel })
              : used > 0
                ? fmt(m.chat.filesBudget, { n: num.format(used), model: modelLabel, max: num.format(windowTokens) })
                : null}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110"
          >
            {m.chat.filesDone}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaperclipIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
    </svg>
  );
}
