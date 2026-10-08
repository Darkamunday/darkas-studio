"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { addMcpServer, refreshMcpServer, setMcpToolAccess, setMcpToolApproval } from "../../actions";
import type { Access } from "@/lib/mcp/registry";

const field = "w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-pink";

/** A tool's access (submits as soon as it changes). */
export function AccessSelect({ serverId, tool, access, label }: { serverId: number; tool: string; access: Access; label: string }) {
  const { m } = useI18n();
  const c = m.connections;
  return (
    <form action={setMcpToolAccess}>
      <input type="hidden" name="serverId" value={serverId} />
      <input type="hidden" name="tool" value={tool} />
      <select
        name="access"
        defaultValue={access}
        key={access}
        aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`rounded-lg border bg-surface-2 px-2 py-1 text-xs outline-none ${
          access === "everyone" ? "border-success/50 text-success" : access === "admins" ? "border-violet/50 text-violet" : "border-line text-subtle"
        }`}
      >
        <option value="off">{c.accessOff}</option>
        <option value="admins">{c.accessAdmins}</option>
        <option value="everyone">{c.accessEveryone}</option>
      </select>
    </form>
  );
}

/** "Ask first" for a tool (submits as soon as it changes). */
export function ApprovalBox({ serverId, tool, approval, label }: { serverId: number; tool: string; approval: boolean; label: string }) {
  return (
    <form action={setMcpToolApproval}>
      <input type="hidden" name="serverId" value={serverId} />
      <input type="hidden" name="tool" value={tool} />
      <input type="hidden" name="approval" value={approval ? "0" : "1"} />
      {/* Ticks at once (then follows the saved value, via the key) rather than waiting for the server. */}
      <input
        type="checkbox"
        defaultChecked={approval}
        key={String(approval)}
        aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-4 w-4 accent-[var(--pink)]"
      />
    </form>
  );
}

export function RefreshButton({ serverId }: { serverId: number }) {
  const { m } = useI18n();
  const [state, action, pending] = useActionState(refreshMcpServer, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="serverId" value={serverId} />
      <button disabled={pending} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg disabled:opacity-60">
        {pending ? "…" : m.connections.refresh}
      </button>
      {state?.error && <span className="text-xs text-danger">{m.connections.refreshFailed}</span>}
    </form>
  );
}

export function AddServerForm() {
  const { m } = useI18n();
  const c = m.connections;
  const [state, action, pending] = useActionState(addMcpServer, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">
        {c.serverName}
        <input name="name" required maxLength={40} className={`${field} mt-1`} />
      </label>
      <label className="text-sm font-medium">
        {c.serverUrl}
        <input name="url" required type="url" placeholder="https://…/mcp" className={`${field} mt-1`} />
      </label>
      <label className="text-sm font-medium">
        {c.headerName}
        <input name="headerName" placeholder="Authorization" className={`${field} mt-1`} />
      </label>
      <label className="text-sm font-medium">
        {c.headerValue}
        <input name="headerValue" type="password" autoComplete="off" className={`${field} mt-1`} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
          {pending ? "…" : c.add}
        </button>
        {state?.error && <span className="text-sm text-danger">{c.refreshFailed}</span>}
      </div>
      <p className="text-xs text-subtle sm:col-span-2">{c.keyNote}</p>
    </form>
  );
}
