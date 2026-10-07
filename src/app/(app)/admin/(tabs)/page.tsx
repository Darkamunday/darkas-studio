import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getCredits } from "@/lib/suno";
import { recentGenerations, usageTotals } from "@/lib/usage";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt, lookup } from "@/lib/i18n/format";
import { CREDITS_PER_GENERATION } from "../credits";
import { Stat, StatusDot } from "../ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.admin };
}

async function fetchCredits(): Promise<number | null> {
  try {
    return await getCredits();
  } catch (err) {
    console.error("[admin] credit check failed", err);
    return null;
  }
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const { locale, m } = await getI18n();
  const a = m.admin;
  const tag = LOCALE_INFO[locale].tag;
  const dateTimeFmt = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

  const [credits, totals, recent] = [await fetchCredits(), usageTotals(), recentGenerations()];

  return (
    <div className="flex flex-col gap-8">
      {/* ---- headline numbers ---- */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={a.credits}
          value={credits === null ? "?" : credits.toLocaleString(tag)}
          sub={
            credits === null
              ? a.creditsUnreachable
              : fmt(a.generationsLeft, { n: Math.floor(credits / CREDITS_PER_GENERATION).toLocaleString(tag) })
          }
          accent
        />
        <Stat label={a.generations} value={totals.total} sub={fmt(a.doneFailed, { done: totals.completed, failed: totals.failed })} />
        <Stat label={a.thisWeek} value={totals.last_7d} sub={a.last7} />
        <Stat label={a.tracks} value={totals.tracks} sub={a.inCatalogue} />
      </section>

      {/* ---- recent activity ---- */}
      <section className="min-w-0 rounded-3xl border border-line bg-surface shadow-card p-6">
        <h2 className="mb-4 text-lg font-semibold">{a.recent}</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">{a.quiet}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {recent.map((g) => (
              <li key={g.id} className="flex items-start gap-3 py-2.5">
                <StatusDot status={g.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fg" title={g.summary ?? ""}>
                    {g.summary ?? "—"}
                  </p>
                  <p className="text-xs text-subtle">
                    {g.username} · {g.mode === "remix" ? "remix" : m.generate[g.mode]} · {g.model} · {dateTimeFmt.format(new Date(g.created_at * 1000))}
                  </p>
                  {g.error && <p className="text-xs text-danger">{lookup(m.generationErrors, g.error)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
