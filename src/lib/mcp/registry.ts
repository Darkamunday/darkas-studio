import "server-only";
import { db, transaction } from "../db";
import { listTools, type McpEndpoint, type McpTool } from "./client";

// The MCP servers chat can use, and who may use which of their tools. Servers and per-tool settings
// live in the database (Admin → Connections); each server's tool list is fetched and cached there.

export type Access = "off" | "admins" | "everyone";

type ServerRow = {
  id: number;
  slug: string;
  name: string;
  url: string;
  header_name: string | null;
  header_value: string | null;
  header_env: string | null;
  enabled: number;
  builtin: number;
  tools_json: string | null;
  tools_fetched_at: number | null;
};

/** A tool someone may use, as the chat sees it. `qualified` is the name the model calls it by. */
export type AvailableTool = {
  serverId: number;
  serverSlug: string;
  serverName: string;
  name: string;
  qualified: string;
  description: string;
  inputSchema: Record<string, unknown>;
  approval: boolean;
};

const rowById = (id: number) => db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as ServerRow | undefined;

/** Where to reach a server and how to sign in. The built-in Comfy entry honours COMFY_MCP_URL (tests). */
export function endpointFor(server: ServerRow): McpEndpoint {
  const secret = server.header_env ? process.env[server.header_env] : server.header_value;
  const url = server.builtin && server.slug === "comfy" && process.env.COMFY_MCP_URL ? process.env.COMFY_MCP_URL : server.url;
  return { key: `server-${server.id}`, url, headers: server.header_name && secret ? { [server.header_name]: secret } : {} };
}

// ---- admin -------------------------------------------------------------------------------

export type ServerToolSetting = { name: string; description: string; access: Access; approval: boolean };
export type AdminServer = {
  id: number;
  slug: string;
  name: string;
  url: string;
  auth: string | null;
  enabled: boolean;
  builtin: boolean;
  fetchedAt: number | null;
  tools: ServerToolSetting[];
};

const cachedTools = (s: ServerRow): McpTool[] => (s.tools_json ? (JSON.parse(s.tools_json) as McpTool[]) : []);

export function listServers(): AdminServer[] {
  const rows = db.prepare("SELECT * FROM mcp_servers ORDER BY builtin DESC, name COLLATE NOCASE").all() as ServerRow[];
  return rows.map((s) => {
    const settings = new Map(
      (db.prepare("SELECT name, access, approval FROM mcp_tools WHERE server_id = ?").all(s.id) as { name: string; access: Access; approval: number }[]).map(
        (t) => [t.name, t],
      ),
    );
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      url: s.url,
      // Never the secret itself: where it comes from, or a mask.
      auth: s.header_name ? `${s.header_name}: ${s.header_env ? `$${s.header_env}` : s.header_value ? "••••" + s.header_value.slice(-4) : "—"}` : null,
      enabled: !!s.enabled,
      builtin: !!s.builtin,
      fetchedAt: s.tools_fetched_at,
      tools: cachedTools(s).map((t) => ({
        name: t.name,
        description: t.description,
        access: settings.get(t.name)?.access ?? "off",
        approval: settings.get(t.name)?.approval !== 0,
      })),
    };
  });
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20) || "server";

export function addServer(input: { name: string; url: string; headerName: string | null; headerValue: string | null }): number {
  let slug = slugify(input.name);
  for (let n = 2; db.prepare("SELECT 1 FROM mcp_servers WHERE slug = ?").get(slug); n++) slug = `${slugify(input.name)}_${n}`;
  return Number(
    db
      .prepare("INSERT INTO mcp_servers (slug, name, url, header_name, header_value) VALUES (?, ?, ?, ?, ?)")
      .run(slug, input.name, input.url, input.headerName, input.headerValue).lastInsertRowid,
  );
}

/** Remove a server you added (the built-in one stays; switch it off instead). */
export function deleteServer(id: number): boolean {
  return db.prepare("DELETE FROM mcp_servers WHERE id = ? AND builtin = 0").run(id).changes > 0;
}

export function setServerEnabled(id: number, enabled: boolean) {
  db.prepare("UPDATE mcp_servers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function setToolAccess(serverId: number, name: string, access: Access) {
  db.prepare("UPDATE mcp_tools SET access = ? WHERE server_id = ? AND name = ?").run(access, serverId, name);
}

export function setToolApproval(serverId: number, name: string, approval: boolean) {
  db.prepare("UPDATE mcp_tools SET approval = ? WHERE server_id = ? AND name = ?").run(approval ? 1 : 0, serverId, name);
}

/** Fetch a server's tool list again. New tools get their defaults; tools that went away are dropped. */
export async function refreshTools(id: number): Promise<number> {
  const server = rowById(id);
  if (!server) return 0;
  const tools = await listTools(endpointFor(server));
  transaction(() => {
    db.prepare("UPDATE mcp_servers SET tools_json = ?, tools_fetched_at = unixepoch() WHERE id = ?").run(JSON.stringify(tools), id);
    const add = db.prepare("INSERT OR IGNORE INTO mcp_tools (server_id, name, access, approval) VALUES (?, ?, ?, ?)");
    for (const t of tools) {
      const d = defaultsFor(server.slug, t.name);
      add.run(id, t.name, d.access, d.approval ? 1 : 0);
    }
    const names = new Set(tools.map((t) => t.name));
    for (const r of db.prepare("SELECT name FROM mcp_tools WHERE server_id = ?").all(id) as { name: string }[]) {
      if (!names.has(r.name)) db.prepare("DELETE FROM mcp_tools WHERE server_id = ? AND name = ?").run(id, r.name);
    }
  });
  return tools.length;
}

// ---- starting settings ---------------------------------------------------------------------

/**
 * Comfy Cloud's tools: anything acting on the account itself (billing, saving or sharing workflows,
 * apps, feedback, the queue) starts off; look-ups and job checks start at admins; paid generation
 * starts at admins with approval. Other servers' tools start off, with approval, until set.
 */
const COMFY_ADMIN_FREE = new Set([
  "search_models", "search_nodes", "get_node", "search_templates", "get_catalog_overview", "get_template", "cql",
  "get_template_schema", "apply_slots", "estimate_credits", "get_prompting_guide", "get_creative_technique",
  "get_job_status", "wait_for_job", "get_output", "get_batch_status", "get_batch_output", "wait_for_batch", "use_previous_output",
]);
const COMFY_ADMIN_PAID = new Set(["partner_generate", "submit_workflow", "run_template", "submit_batch"]);

function defaultsFor(serverSlug: string, tool: string): { access: Access; approval: boolean } {
  if (serverSlug === "comfy") {
    if (COMFY_ADMIN_FREE.has(tool)) return { access: "admins", approval: false };
    if (COMFY_ADMIN_PAID.has(tool)) return { access: "admins", approval: true };
  }
  return { access: "off", approval: true };
}

// ---- for chat -----------------------------------------------------------------------------

/** Every tool this person may use, across switched-on servers. */
export function toolsFor(isAdmin: boolean): AvailableTool[] {
  const servers = db.prepare("SELECT * FROM mcp_servers WHERE enabled = 1").all() as ServerRow[];
  const out: AvailableTool[] = [];
  for (const s of servers) {
    const settings = new Map(
      (db.prepare("SELECT name, access, approval FROM mcp_tools WHERE server_id = ?").all(s.id) as { name: string; access: Access; approval: number }[]).map(
        (t) => [t.name, t],
      ),
    );
    for (const t of cachedTools(s)) {
      const st = settings.get(t.name);
      if (!st || st.access === "off" || (st.access === "admins" && !isAdmin)) continue;
      out.push({
        serverId: s.id,
        serverSlug: s.slug,
        serverName: s.name,
        name: t.name,
        qualified: `${s.slug}__${t.name}`.slice(0, 64),
        description: t.description,
        inputSchema: t.inputSchema,
        approval: st.approval !== 0,
      });
    }
  }
  return out;
}

export function serverEndpoint(serverId: number): McpEndpoint | null {
  const s = rowById(serverId);
  return s && s.enabled ? endpointFor(s) : null;
}

/** Tools a chat has loaded (their full definitions go to the model). */
export function loadedTools(conversationId: number): Set<string> {
  return new Set(
    (
      db.prepare("SELECT s.slug, ct.name FROM conversation_tools ct JOIN mcp_servers s ON s.id = ct.server_id WHERE ct.conversation_id = ?").all(
        conversationId,
      ) as { slug: string; name: string }[]
    ).map((r) => `${r.slug}__${r.name}`),
  );
}

export function markLoaded(conversationId: number, tool: AvailableTool) {
  db.prepare("INSERT OR IGNORE INTO conversation_tools (conversation_id, server_id, name) VALUES (?, ?, ?)").run(
    conversationId,
    tool.serverId,
    tool.name,
  );
}

/** One line per tool for the catalogue in the system prompt: the first sentence of its description. */
export function catalogueLine(t: AvailableTool): string {
  const first = t.description.replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0].slice(0, 160);
  return `- ${t.qualified}: ${first}${t.approval ? " (asks the person first)" : ""}`;
}
