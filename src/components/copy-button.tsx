"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";

export async function copyText(text: string) {
  // The Clipboard API only exists on https/localhost; fall back for plain-http LAN access.
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy failed");
}

export function CopyButton({ text, label, className = "" }: { text: string; label?: string; className?: string }) {
  const { m } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const onClick = async () => {
    try {
      await copyText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button type="button" onClick={onClick} title={text} className={className}>
      {state === "copied" ? m.common.copied : state === "failed" ? m.common.copyFailed : (label ?? m.common.copy)}
    </button>
  );
}
