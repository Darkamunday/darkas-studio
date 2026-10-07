import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getMasterPrompt } from "@/lib/chat/master-prompt";
import { chatUsageByUser, chatUsageTotals } from "@/lib/chat/usage";
import { DEFAULT_DAILY_CAP } from "@/config/chat";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/format";
import { setChatCap, setChatEnabled, setChatForAll } from "../../actions";
import { ConfirmButton } from "../../confirm-button";
import { MasterPromptForm } from "../../master-prompt-form";
import { Badge, SmallButton } from "../../ui";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: `${m.meta.admin} · ${m.admin.tabChat}` };
}

export default async function AdminChatPage() {
  await requireAdmin();
  const { locale, m } = await getI18n();
  const a = m.admin;
  const c = m.chatAdmin;
  const tag = LOCALE_INFO[locale].tag;
  const dateTimeFmt = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

  const chatUsers = chatUsageByUser();
  const chatTotals = chatUsageTotals();
  const master = getMasterPrompt();

  return (
    <div className="flex flex-col gap-8">
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
    </div>
  );
}
