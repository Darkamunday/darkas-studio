import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getCredits } from "@/lib/suno";
import { appUrl } from "@/lib/url";
import { CopyButton } from "@/components/copy-button";
import { recentGenerations, usageByUser, usageTotals } from "@/lib/usage";
import { createInvite, revokeInvite, setUserAdmin, setUserDisabled } from "./actions";

export const metadata: Metadata = { title: "Admin" };

// sunoapi.org charged 12 credits per generation (two takes) when this was written.
const CREDITS_PER_GENERATION = Number(process.env.SUNO_CREDITS_PER_GENERATION) || 12;

type InviteRow = { code: string; used_by_name: string | null; used_at: number | null; created_at: number };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});
const fmtDate = (s: number | null) => (s ? dateFmt.format(new Date(s * 1000)) : "—");

async function fetchCredits(): Promise<number | null> {
  try {
    return await getCredits();
  } catch (err) {
    console.error("[admin] credit check failed", err);
    return null;
  }
}

export default async function AdminPage() {
  const me = await requireAdmin();
  const base = await appUrl();

  const [credits, users, totals, recent] = [await fetchCredits(), usageByUser(), usageTotals(), recentGenerations()];
  const invites = db
    .prepare(
      `SELECT i.code, u.username AS used_by_name, i.used_at, i.created_at
         FROM invite_codes i LEFT JOIN users u ON u.id = i.used_by
        ORDER BY i.used_by IS NOT NULL, i.created_at DESC`,
    )
    .all() as InviteRow[];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-4xl font-semibold sm:text-5xl">Admin</h1>
        <p className="mt-3 text-muted">Who&apos;s making what, and how much fuel is left in the tank.</p>
      </div>

      {/* ---- headline numbers ---- */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Suno credits"
          value={credits === null ? "?" : credits.toLocaleString("en-GB")}
          sub={
            credits === null
              ? "Couldn't reach Suno"
              : `≈ ${Math.floor(credits / CREDITS_PER_GENERATION)} generations left`
          }
          accent
        />
        <Stat label="Generations" value={totals.total} sub={`${totals.completed} done · ${totals.failed} failed`} />
        <Stat label="This week" value={totals.last_7d} sub="last 7 days" />
        <Stat label="Tracks" value={totals.tracks} sub="in the catalogue" />
      </section>

      {/* ---- per-user usage ---- */}
      <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Usage by person</h2>
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="whitespace-nowrap text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 text-right font-medium">Total</th>
                <th className="py-2 pr-4 text-right font-medium">Done</th>
                <th className="py-2 pr-4 text-right font-medium">Failed</th>
                <th className="py-2 pr-4 text-right font-medium">7 days</th>
                <th className="py-2 pr-4 text-right font-medium">≈ Credits</th>
                <th className="py-2 pr-4 font-medium">Last made</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} className={u.disabled ? "text-subtle" : ""}>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="whitespace-nowrap font-medium">{u.username}</span>
                        {u.is_admin ? <Badge tone="violet">admin</Badge> : null}
                        {u.disabled ? <Badge tone="rose">disabled</Badge> : null}
                        {u.in_progress ? <Badge tone="pink">{u.in_progress} cooking</Badge> : null}
                      </div>
                      <div className="whitespace-nowrap text-xs text-subtle">joined {fmtDate(u.created_at)}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{u.total}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{u.completed}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{u.failed}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{u.last_7d}</td>
                    {/* Failed generations generally aren't charged, so count completed ones. */}
                    <td className="py-2.5 pr-4 text-right tabular-nums">{u.completed * CREDITS_PER_GENERATION}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{fmtDate(u.last_generated_at)}</td>
                    <td className="py-2.5 text-right">
                      {self ? (
                        <span className="text-xs text-subtle">you</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <form action={setUserAdmin}>
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="admin" value={u.is_admin ? "0" : "1"} />
                            <SmallButton>{u.is_admin ? "Remove admin" : "Make admin"}</SmallButton>
                          </form>
                          <form action={setUserDisabled}>
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="disabled" value={u.disabled ? "0" : "1"} />
                            <SmallButton danger={!u.disabled}>{u.disabled ? "Enable" : "Disable"}</SmallButton>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ---- recent activity ---- */}
        {/* min-w-0: grid items default to their content's min width, so long truncated titles would widen the column. */}
        <section className="min-w-0 rounded-3xl border border-line bg-surface shadow-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Recent generations</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet — the studio&apos;s quiet.</p>
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
                      {g.username} · {g.mode} · {g.model} · {dateTimeFmt.format(new Date(g.created_at * 1000))}
                    </p>
                    {g.error && <p className="text-xs text-danger">{g.error}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- invites ---- */}
        <section className="min-w-0 rounded-3xl border border-line bg-surface shadow-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Invite codes</h2>
            <form action={createInvite}>
              <button className="rounded-xl bg-brand px-3 py-1.5 text-sm font-medium text-white shadow-glow transition hover:brightness-110">
                New invite code
              </button>
            </form>
          </div>
          {invites.length === 0 ? (
            <p className="text-sm text-muted">No invites yet. Make one and send it to a friend.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {invites.map((inv) => (
                <li key={inv.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <code className={`font-mono text-base tracking-wider ${inv.used_by_name ? "text-subtle" : ""}`}>
                    {inv.code}
                  </code>
                  {inv.used_by_name ? (
                    <span className="text-subtle">
                      used by {inv.used_by_name} · {fmtDate(inv.used_at)}
                    </span>
                  ) : (
                    <>
                      <span className="text-success">unused</span>
                      <div className="ml-auto flex items-center gap-1">
                        <CopyButton
                          text={`${base}/signup?code=${inv.code}`}
                          label="Copy link"
                          className="rounded-lg bg-pink/12 px-2.5 py-1 text-xs font-medium text-accent-fg transition hover:bg-pink/20"
                        />
                        <form action={revokeInvite}>
                          <input type="hidden" name="code" value={inv.code} />
                          <button className="rounded-lg px-2 py-1 text-xs text-muted transition hover:text-danger">Revoke</button>
                        </form>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-subtle">
            Send a friend the link — it opens sign-up with the code filled in. Each code works once.
          </p>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent?: boolean }) {
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

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${BADGE_TONES[tone]}`}>{children}</span>;
}

function SmallButton({ danger, children }: { danger?: boolean; children: React.ReactNode }) {
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

function StatusDot({ status }: { status: string }) {
  const color =
    status === "complete" ? "bg-success" : status === "failed" ? "bg-danger" : "animate-pulse bg-pink";
  return <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${color}`} title={status} />;
}
