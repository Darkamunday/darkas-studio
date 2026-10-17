import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/format";
import { videoUsageByUser } from "@/lib/video/store";
import { DEFAULT_MONTHLY_CREDIT_CAP } from "@/config/video";
import { setVideoAccess, setVideoCap, setVideoForAll } from "../../actions";
import { ConfirmButton } from "../../confirm-button";
import { SmallButton } from "../../ui";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: `${m.meta.admin} · ${m.admin.tabVideos}` };
}

// Who can make music videos, their monthly Comfy credit caps, and what they've used.
export default async function AdminVideosPage() {
  await requireAdmin();
  const { m } = await getI18n();
  const v = m.videoAdmin;
  const c = m.chatAdmin;
  const people = videoUsageByUser();
  const num = new Intl.NumberFormat();

  return (
    <section className="rounded-3xl border border-line bg-surface p-6 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{v.heading}</h2>
        <div className="flex gap-2">
          <form action={setVideoForAll}>
            <input type="hidden" name="enabled" value="1" />
            <SmallButton>{v.enableAll}</SmallButton>
          </form>
          <form action={setVideoForAll}>
            <input type="hidden" name="enabled" value="0" />
            <ConfirmButton
              message={v.disableAllConfirm}
              className="whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger"
            >
              {v.disableAll}
            </ConfirmButton>
          </form>
        </div>
      </div>
      <p className="text-sm text-muted">{fmt(v.blurb, { cap: num.format(DEFAULT_MONTHLY_CREDIT_CAP) })}</p>
      <div className="-mx-6 mt-4 overflow-x-auto px-6">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
              <th className="py-2 pr-4 font-medium">{v.colPerson}</th>
              <th className="py-2 pr-4 font-medium">{v.colVideos}</th>
              <th className="py-2 pr-4 font-medium">{v.colCap}</th>
              <th className="py-2 pr-4 text-right font-medium">{v.colMonth}</th>
              <th className="py-2 text-right font-medium">{v.colCount}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {people.map((u) => (
              <tr key={u.id}>
                <td className="py-2.5 pr-4 font-medium">
                  {u.username}
                  {u.is_admin ? <span className="ml-1.5 text-xs font-normal text-subtle">· {v.admin}</span> : null}
                </td>
                <td className="py-2.5 pr-4">
                  {
                    <form action={setVideoAccess} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="enabled" value={u.video_enabled ? "0" : "1"} />
                      <button
                        role="switch"
                        aria-checked={!!u.video_enabled}
                        aria-label={`${v.colVideos}: ${u.username}`}
                        title={u.video_enabled ? c.turnOff : c.turnOn}
                        className={`relative h-6 w-11 flex-none rounded-full transition ${u.video_enabled ? "bg-brand shadow-glow" : "bg-surface-3"}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${u.video_enabled ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                      <span className={`text-xs ${u.video_enabled ? "text-success" : "text-subtle"}`}>{u.video_enabled ? c.on : c.off}</span>
                    </form>
                  }
                </td>
                <td className="py-2.5 pr-4">
                  {u.is_admin ? (
                    <span className="text-xs text-subtle">{c.noLimit}</span>
                  ) : (
                    <form action={setVideoCap} className="flex items-center gap-1.5" key={u.video_credit_cap ?? "default"}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input
                        name="cap"
                        type="number"
                        min={0}
                        max={1000000}
                        inputMode="numeric"
                        defaultValue={u.video_credit_cap ?? ""}
                        placeholder={String(DEFAULT_MONTHLY_CREDIT_CAP)}
                        aria-label={`${v.colCap}: ${u.username}`}
                        className="w-24 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm tabular-nums outline-none focus:border-pink"
                      />
                      <SmallButton>{c.save}</SmallButton>
                    </form>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{num.format(Math.round(u.month))}</td>
                <td className="py-2.5 text-right tabular-nums">{u.videos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
