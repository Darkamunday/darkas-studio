import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getCredits } from "@/lib/suno";
import { appUrl } from "@/lib/url";
import { CopyButton } from "@/components/copy-button";
import { recentGenerations, usageByUser, usageTotals } from "@/lib/usage";
import { BIN_DAYS, listAdminRemoved, purgeExpiredBin } from "@/lib/bin";
import { timedLyricsCandidates } from "@/lib/timed-lyrics";
import { BinRow, DaysLeft } from "../catalogue/deleted/bin-row";
import { createInvite, revokeInvite, setChatCap, setChatEnabled, setChatForAll, setUserAdmin, setUserDisabled } from "./actions";
import { ConfirmButton } from "./confirm-button";
import { MasterPromptForm } from "./master-prompt-form";
import { getMasterPrompt } from "@/lib/chat/master-prompt";
import { chatUsageByUser, chatUsageTotals } from "@/lib/chat/usage";
import { DEFAULT_DAILY_CAP } from "@/config/chat";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt, lookup } from "@/lib/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.admin };
}

// sunoapi.org charged 12 credits per generation (two takes) when this was written.
const CREDITS_PER_GENERATION = Number(process.env.SUNO_CREDITS_PER_GENERATION) || 12;

type InviteRow = { code: string; used_by_name: string | null; used_at: number | null; created_at: number };


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
  const { locale, m } = await getI18n();
  const a = m.admin;
  const tag = LOCALE_INFO[locale].tag;
  const dateFmt = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "Europe/London" });
  const dateTimeFmt = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const fmtDate = (s: number | null) => (s ? dateFmt.format(new Date(s * 1000)) : "—");

  await purgeExpiredBin();
  const [credits, users, totals, recent] = [await fetchCredits(), usageByUser(), usageTotals(), recentGenerations()];
  const removed = listAdminRemoved();
  const chatUsers = chatUsageByUser();
  const chatTotals = chatUsageTotals();
  const c = m.chatAdmin;
  const master = getMasterPrompt();
  const timedCandidates = timedLyricsCandidates(me.id);
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
        <h1 className="text-4xl font-semibold sm:text-5xl">{m.nav.admin}</h1>
        <p className="mt-3 text-muted">{a.blurb}</p>
      </div>

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

      {/* ---- per-user usage ---- */}
      <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
        <h2 className="mb-4 text-lg font-semibold">{a.usage}</h2>
        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="whitespace-nowrap text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th className="py-2 pr-4 font-medium">{a.colUser}</th>
                <th className="py-2 pr-4 text-right font-medium">{a.colTotal}</th>
                <th className="py-2 pr-4 text-right font-medium">{a.colDone}</th>
                <th className="py-2 pr-4 text-right font-medium">{a.colFailed}</th>
                <th className="py-2 pr-4 text-right font-medium">{a.col7}</th>
                <th className="py-2 pr-4 text-right font-medium">{a.colCredits}</th>
                <th className="py-2 pr-4 font-medium">{a.colLast}</th>
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
                        {u.is_admin ? <Badge tone="violet">{a.badgeAdmin}</Badge> : null}
                        {u.disabled ? <Badge tone="rose">{a.badgeDisabled}</Badge> : null}
                        {u.in_progress ? <Badge tone="pink">{fmt(a.cooking, { n: u.in_progress })}</Badge> : null}
                      </div>
                      <div className="whitespace-nowrap text-xs text-subtle">{fmt(a.joined, { date: fmtDate(u.created_at) })}</div>
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
                        <span className="text-xs text-subtle">{a.you}</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <form action={setUserAdmin}>
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="admin" value={u.is_admin ? "0" : "1"} />
                            <SmallButton>{u.is_admin ? a.removeAdmin : a.makeAdmin}</SmallButton>
                          </form>
                          <form action={setUserDisabled}>
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="disabled" value={u.disabled ? "0" : "1"} />
                            <SmallButton danger={!u.disabled}>{u.disabled ? a.enable : a.disable}</SmallButton>
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

      {/* ---- chat access ---- */}
      <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{c.heading}</h2>
          <div className="flex gap-2">
            <form action={setChatForAll}>
              <input type="hidden" name="enabled" value="1" />
              <SmallButton>{c.enableAll}</SmallButton>
            </form>
            <form action={setChatForAll}>
              <input type="hidden" name="enabled" value="0" />
              <ConfirmButton
                message={c.disableAllConfirm}
                className="whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger"
              >
                {c.disableAll}
              </ConfirmButton>
            </form>
          </div>
        </div>
        <p className="text-sm text-muted">{fmt(c.blurb, { cap: DEFAULT_DAILY_CAP })}</p>
        <p className="mt-1 text-sm font-medium text-accent-fg">
          {fmt(c.totals, { today: chatTotals.today, week: chatTotals.week })}
        </p>
        <div className="-mx-6 mt-4 overflow-x-auto px-6">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="whitespace-nowrap text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th className="py-2 pr-4 font-medium">{a.colUser}</th>
                <th className="py-2 pr-4 font-medium">{c.colChat}</th>
                <th className="py-2 pr-4 font-medium">{c.colLimit}</th>
                <th className="py-2 pr-4 text-right font-medium">{c.colToday}</th>
                <th className="py-2 pr-4 text-right font-medium">{c.colWeek}</th>
                <th className="py-2 pr-4 text-right font-medium">{c.colTotal}</th>
                <th className="py-2 text-right font-medium">{c.colChats}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {chatUsers.map((u) => {
                const has = !!u.is_admin || !!u.chat_enabled;
                const cap = u.is_admin ? null : (u.chat_daily_cap ?? DEFAULT_DAILY_CAP);
                return (
                  <tr key={u.id} className={u.disabled ? "text-subtle" : ""}>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="whitespace-nowrap font-medium">{u.username}</span>
                        {u.is_admin ? <Badge tone="violet">{a.badgeAdmin}</Badge> : null}
                        {u.disabled ? <Badge tone="rose">{a.badgeDisabled}</Badge> : null}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      {u.is_admin ? (
                        <span className="text-xs text-subtle">{c.always}</span>
                      ) : (
                        <form action={setChatEnabled} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="enabled" value={u.chat_enabled ? "0" : "1"} />
                          <button
                            role="switch"
                            aria-checked={!!u.chat_enabled}
                            aria-label={`${c.colChat}: ${u.username}`}
                            title={u.chat_enabled ? c.turnOff : c.turnOn}
                            className={`relative h-6 w-11 flex-none rounded-full transition ${
                              u.chat_enabled ? "bg-brand shadow-glow" : "bg-surface-3"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                                u.chat_enabled ? "left-[22px]" : "left-0.5"
                              }`}
                            />
                          </button>
                          <span className={`text-xs ${u.chat_enabled ? "text-success" : "text-subtle"}`}>
                            {u.chat_enabled ? c.on : c.off}
                          </span>
                        </form>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      {u.is_admin ? (
                        <span className="text-xs text-subtle">{c.noLimit}</span>
                      ) : (
                        <form action={setChatCap} className="flex items-center gap-1.5" key={u.chat_daily_cap ?? "default"}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input
                            name="cap"
                            type="number"
                            min={0}
                            max={100000}
                            inputMode="numeric"
                            defaultValue={u.chat_daily_cap ?? ""}
                            placeholder={String(DEFAULT_DAILY_CAP)}
                            aria-label={`${c.colLimit}: ${u.username}`}
                            className="w-20 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm tabular-nums outline-none focus:border-pink"
                          />
                          <SmallButton>{c.save}</SmallButton>
                        </form>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {u.today}
                      {cap !== null && has ? <span className="text-subtle"> / {cap}</span> : null}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{u.week}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{u.total}</td>
                    <td className="py-2.5 text-right tabular-nums">{u.chats}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <MasterPromptForm
          key={master.updated_at ?? "default"}
          initial={master.text}
          custom={master.custom}
          status={
            master.custom
              ? fmt(c.masterCustom, { name: master.updated_by_name ?? "?", date: dateTimeFmt.format(new Date(master.updated_at! * 1000)) })
              : c.masterDefault
          }
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ---- recent activity ---- */}
        {/* min-w-0: grid items default to their content's min width, so long truncated titles would widen the column. */}
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

        {/* ---- invites ---- */}
        <section className="min-w-0 rounded-3xl border border-line bg-surface shadow-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{a.invites}</h2>
            <form action={createInvite}>
              <button className="rounded-xl bg-brand px-3 py-1.5 text-sm font-medium text-white shadow-glow transition hover:brightness-110">
                {a.newInvite}
              </button>
            </form>
          </div>
          {invites.length === 0 ? (
            <p className="text-sm text-muted">{a.noInvites}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {invites.map((inv) => (
                <li key={inv.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <code className={`font-mono text-base tracking-wider ${inv.used_by_name ? "text-subtle" : ""}`}>
                    {inv.code}
                  </code>
                  {inv.used_by_name ? (
                    <span className="text-subtle">{fmt(a.usedBy, { name: inv.used_by_name, date: fmtDate(inv.used_at) })}</span>
                  ) : (
                    <>
                      <span className="text-success">{a.unused}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <CopyButton
                          text={`${base}/signup?code=${inv.code}`}
                          label={a.copyLink}
                          className="rounded-lg bg-pink/12 px-2.5 py-1 text-xs font-medium text-accent-fg transition hover:bg-pink/20"
                        />
                        <form action={revokeInvite}>
                          <input type="hidden" name="code" value={inv.code} />
                          <button className="rounded-lg px-2 py-1 text-xs text-muted transition hover:text-danger">{a.revoke}</button>
                        </form>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-subtle">{a.inviteNote}</p>
        </section>
      </div>

      {/* ---- timestamped lyrics ---- */}
      <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
        <h2 className="text-lg font-semibold">{m.timed.heading}</h2>
        <p className="mt-1 text-sm text-muted">{m.timed.adminBlurb}</p>
        {timedCandidates.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{m.timed.noTracks}</p>
        ) : (
          <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
            {timedCandidates.map((t) => (
              <li key={t.id} className="border-b border-line">
                <Link href={`/admin/lyrics/${t.id}`} className="flex items-center gap-2 py-2.5 text-sm transition hover:text-accent-fg">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{t.title ?? m.common.untitled}</span>{" "}
                    <span className="text-subtle">· {t.username} · {fmtDate(t.created_at)}</span>
                  </span>
                  {t.has_timings ? <Badge tone="violet">{m.timed.saved}</Badge> : null}
                  <span aria-hidden className="text-subtle">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- songs admins removed (not in their owners' bins) ---- */}
      {removed.length > 0 && (
        <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
          <h2 className="text-lg font-semibold">{m.bin.adminHeading}</h2>
          <p className="mt-1 text-sm text-muted">{fmt(m.bin.adminBlurb, { days: BIN_DAYS })}</p>
          <ul className="-mx-4 mt-2 divide-y divide-line">
            {removed.map((t) => (
              <BinRow key={t.id} track={t} title={t.title ?? m.common.untitled}>
                {fmt(m.bin.adminRow, { owner: t.username, by: t.deleted_by_name ?? "?", date: fmtDate(t.deleted_at) })} ·{" "}
                <DaysLeft days={t.days_left} />
              </BinRow>
            ))}
          </ul>
        </section>
      )}
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
