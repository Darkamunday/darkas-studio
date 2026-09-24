"use client";

import { usePathname, useRouter } from "next/navigation";

type Facet = { value: string; n: number };

export function FilterBar({
  genres,
  creators,
  current,
}: {
  genres: Facet[];
  creators: Facet[];
  current: { genre?: string; creator?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();

  const set = (key: "genre" | "creator", value: string) => {
    const next = new URLSearchParams();
    const merged = { ...current, [key]: value || undefined };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Select label="Genre" value={current.genre ?? ""} options={genres} onChange={(v) => set("genre", v)} />
      <Select label="Creator" value={current.creator ?? ""} options={creators} onChange={(v) => set("creator", v)} />
      {(current.genre || current.creator) && (
        <button onClick={() => router.push(pathname)} className="rounded-lg px-2 py-1 text-muted transition hover:text-fg">
          Clear ✕
        </button>
      )}
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: Facet[]; onChange: (v: string) => void }) {
  // Keep the current value selectable even if it no longer has any tracks.
  const opts =
    value && !options.some((o) => o.value.toLowerCase() === value.toLowerCase()) ? [{ value, n: 0 }, ...options] : options;
  const active = Boolean(value);
  return (
    <label
      className={`relative flex items-center gap-2 rounded-xl border py-1.5 pl-3 pr-8 transition ${
        active ? "border-pink bg-pink/10" : "border-line bg-surface hover:border-line-strong"
      }`}
    >
      <span className="text-subtle">{label}</span>
      <select
        value={opts.find((o) => o.value.toLowerCase() === value.toLowerCase())?.value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent font-medium text-fg outline-none"
      >
        <option value="">All</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} ({o.n})
          </option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 h-4 w-4 text-subtle" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
