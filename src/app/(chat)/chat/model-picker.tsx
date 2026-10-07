"use client";

import { useI18n } from "@/lib/i18n/client";
import { modelsFor } from "@/config/chat";

/** Admins also see the admin-only (pricier) models, marked as such. */
export function ModelPicker({
  value,
  onChange,
  disabled,
  isAdmin,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  isAdmin: boolean;
}) {
  const { m } = useI18n();
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{m.chat.model}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        title={m.chat.model}
        className="cursor-pointer appearance-none rounded-xl border border-line bg-surface py-1.5 pl-3 pr-8 text-sm text-fg transition hover:border-line-strong focus:border-pink focus:outline-none focus:ring-4 focus:ring-pink/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {modelsFor(isAdmin).map((model) => (
          <option key={model.id} value={model.id}>
            {model.adminOnly ? `${model.label} · ${m.chat.adminOnlyModel}` : model.label}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-subtle" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
