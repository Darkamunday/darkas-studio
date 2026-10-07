import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { appUrl } from "@/lib/url";
import { CopyButton } from "@/components/copy-button";
import { usageByUser } from "@/lib/usage";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/format";
import { createInvite, revokeInvite, setUserAdmin, setUserDisabled } from "../../actions";
import { CREDITS_PER_GENERATION } from "../../credits";
import { Badge, SmallButton } from "../../ui";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: `${m.meta.admin} · ${m.admin.tabPeople}` };
}

type InviteRow = { code: string; used_by_name: string | null; used_at: number | null; created_at: number };

export default async function AdminPeoplePage() {
  const me = await requireAdmin();
  const base = await appUrl();
  const { locale, m } = await getI18n();
  const a = m.admin;
  const tag = LOCALE_INFO[locale].tag;
  const dateFmt = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "Europe/London" });
  const fmtDate = (s: number | null) => (s ? dateFmt.format(new Date(s * 1000)) : "—");

  const users = usageByUser();
  const invites = db
    .prepare(
      `SELECT i.code, u.username AS used_by_name, i.used_at, i.created_at
         FROM invite_codes i LEFT JOIN users u ON u.id = i.used_by
        ORDER BY i.used_by IS NOT NULL, i.created_at DESC`,
    )
    .all() as InviteRow[];

  return (
    <div className="flex flex-col gap-8">
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
  );
}
