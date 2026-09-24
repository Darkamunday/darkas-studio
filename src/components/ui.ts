// Shared class strings so every page uses the same buttons, cards, inputs and chips.

export const card = "rounded-3xl border border-line bg-surface shadow-card";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-2.5 font-medium text-white shadow-glow " +
  "transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100";

export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-muted " +
  "transition hover:border-line-strong hover:text-fg active:scale-[0.98] disabled:opacity-60";

export const btnDanger =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-muted " +
  "transition hover:border-danger hover:text-danger active:scale-[0.98] disabled:opacity-60";

export const btnGhost = "rounded-lg px-2 py-1 text-sm text-muted transition hover:text-fg";

export const input =
  "w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-base text-fg outline-none transition " +
  "placeholder:text-subtle focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15";

export const label = "text-sm font-medium text-fg";

export function chip(active: boolean) {
  return (
    "rounded-full border px-3 py-1 text-sm transition " +
    (active
      ? "border-pink bg-pink/12 text-accent-fg"
      : "border-line text-muted hover:border-line-strong hover:text-fg")
  );
}

export const tag = {
  genre: "rounded-full bg-pink/12 px-2.5 py-0.5 text-xs font-medium text-accent-fg",
  mood: "rounded-full bg-violet/15 px-2.5 py-0.5 text-xs font-medium text-violet",
  plain: "rounded-full bg-surface-3 px-2.5 py-0.5 text-xs font-medium text-muted",
};
