import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { listServers, refreshTools } from "@/lib/mcp/registry";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/format";
import { removeMcpServer, setMcpAllAccess, setMcpServerEnabled } from "../../actions";
import { ConfirmButton } from "../../confirm-button";
import { Badge, SmallButton } from "../../ui";
import { AccessSelect, AddServerForm, ApprovalBox, RefreshButton } from "./forms";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: `${m.meta.admin} · ${m.admin.tabConnections}` };
}

export default async function AdminConnectionsPage() {
  await requireAdmin();
  const { locale, m } = await getI18n();
  const c = m.connections;
  const dateFmt = new Intl.DateTimeFormat(LOCALE_INFO[locale].tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

  // The built-in server fetches its tool list the first time this page opens.
  for (const s of listServers().filter((s) => s.fetchedAt === null && s.enabled)) {
    await Promise.race([refreshTools(s.id).catch(() => 0), new Promise((r) => setTimeout(r, 8000))]);
  }
  const servers = listServers();

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
        <h2 className="text-lg font-semibold">{c.heading}</h2>
        <p className="mt-1 text-sm text-muted">{c.blurb}</p>
      </section>

      {servers.map((s) => (
        <section key={s.id} className="rounded-3xl border border-line bg-surface shadow-card p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold">{s.name}</h3>
            {s.builtin && <Badge tone="violet">{c.builtin}</Badge>}
            <form action={setMcpServerEnabled} className="ml-auto">
              <input type="hidden" name="serverId" value={s.id} />
              <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
              <button
                role="switch"
                aria-checked={s.enabled}
                aria-label={`${s.name}: ${s.enabled ? c.on : c.off}`}
                className={`relative h-6 w-11 rounded-full transition ${s.enabled ? "bg-brand shadow-glow" : "bg-surface-3"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.enabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </form>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-subtle">{s.url}</p>
          {s.auth && <p className="mt-0.5 font-mono text-xs text-subtle">{s.auth}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-subtle">
            <span>{s.fetchedAt ? fmt(c.refreshed, { date: dateFmt.format(new Date(s.fetchedAt * 1000)) }) : c.neverFetched}</span>
            <span>· {fmt(c.toolCount, { n: s.tools.length })}</span>
            <RefreshButton serverId={s.id} />
            {s.tools.length > 0 && (
              <span className="flex items-center gap-1.5">
                {c.setAll}
                {(["off", "admins", "everyone"] as const).map((acc) => (
                  <form key={acc} action={setMcpAllAccess}>
                    <input type="hidden" name="serverId" value={s.id} />
                    <input type="hidden" name="access" value={acc} />
                    <SmallButton>{acc === "off" ? c.accessOff : acc === "admins" ? c.accessAdmins : c.accessEveryone}</SmallButton>
                  </form>
                ))}
              </span>
            )}
            {!s.builtin && (
              <form action={removeMcpServer} className="ml-auto">
                <input type="hidden" name="serverId" value={s.id} />
                <ConfirmButton
                  message={fmt(c.removeServerConfirm, { name: s.name })}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger"
                >
                  {c.removeServer}
                </ConfirmButton>
              </form>
            )}
          </div>

          {s.tools.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{c.noTools}</p>
          ) : (
            <div className="-mx-6 mt-4 overflow-x-auto px-6">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="whitespace-nowrap text-xs uppercase tracking-wide text-subtle">
                  <tr>
                    <th className="py-2 pr-4 font-medium">{c.colTool}</th>
                    <th className="py-2 pr-4 font-medium">{c.colAccess}</th>
                    <th className="py-2 font-medium">{c.colApproval}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.tools.map((t) => (
                    <tr key={t.name} className={t.access === "off" ? "text-subtle" : ""}>
                      <td className="py-2 pr-4">
                        <code className="text-xs font-medium">{t.name}</code>
                        <p className="line-clamp-1 max-w-xl text-xs text-subtle" title={t.description}>
                          {t.description}
                        </p>
                      </td>
                      <td className="py-2 pr-4">
                        <AccessSelect serverId={s.id} tool={t.name} access={t.access} label={`${c.colAccess}: ${t.name}`} />
                      </td>
                      <td className="py-2">
                        <ApprovalBox serverId={s.id} tool={t.name} approval={t.approval} label={`${c.colApproval}: ${t.name}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <section className="rounded-3xl border border-line bg-surface shadow-card p-6">
        <h3 className="mb-3 text-lg font-semibold">{c.addServer}</h3>
        <AddServerForm />
      </section>
    </div>
  );
}
