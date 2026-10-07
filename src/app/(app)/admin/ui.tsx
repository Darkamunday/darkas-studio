// Small pieces shared by the admin tabs.

export function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-3xl border p-5 ${
        accent ? "border-pink/40 bg-pink/8 shadow-glow" : "border-line bg-surface shadow-card"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 font-display text-4xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

const BADGE_TONES = {
  violet: "bg-violet/15 text-violet",
  rose: "bg-danger/15 text-danger",
  pink: "bg-pink/12 text-accent-fg",
};

export function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${BADGE_TONES[tone]}`}>{children}</span>;
}

export function SmallButton({ danger, children }: { danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={`whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs ${
        danger
          ? "border-line text-muted hover:border-danger hover:text-danger"
          : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "complete" ? "bg-success" : status === "failed" ? "bg-danger" : "animate-pulse bg-pink";
  return <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${color}`} title={status} />;
}
