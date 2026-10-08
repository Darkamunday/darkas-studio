import "server-only";
import { db, transaction } from "../db";

// Skills: saved instructions for a kind of job. Shared ones (owner_id NULL) are made by admins and
// usable by everyone with chat; the rest are private to their owner.

export type Skill = {
  id: number;
  owner_id: number | null;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  instructions: string;
};

/** A skill as the browser sees it. Shared by server and client code. */
export type ClientSkill = Omit<Skill, "owner_id"> & { shared: boolean };
export const toClientSkill = ({ owner_id, ...s }: Skill): ClientSkill => ({ ...s, shared: owner_id === null });

const COLUMNS = "id, owner_id, slug, name, emoji, description, instructions";
const VISIBLE = "(owner_id IS NULL OR owner_id = ?)";

/** Shared skills first, then the person's own, by name. */
export function listSkills(userId: number): Skill[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM skills WHERE ${VISIBLE} ORDER BY owner_id IS NOT NULL, name COLLATE NOCASE`)
    .all(userId) as Skill[];
}

/** A skill this person can use (shared or their own). */
export function getSkill(userId: number, id: number): Skill | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM skills WHERE id = ? AND ${VISIBLE}`).get(id, userId) as Skill | undefined;
}

/** The skill a /slug means for this person: their own first, then a shared one. */
export function findSkillBySlug(userId: number, slug: string): Skill | undefined {
  return db
    .prepare(`SELECT ${COLUMNS} FROM skills WHERE slug = ? AND ${VISIBLE} ORDER BY owner_id IS NULL LIMIT 1`)
    .get(slug, userId) as Skill | undefined;
}

/** A /slug at the very start of a message, if any. */
export function slashSlug(content: string): string | null {
  return /^\/([a-z0-9][a-z0-9-]{1,29})(?=\s|$)/.exec(content)?.[1] ?? null;
}

/** Whether a slug would clash with one this person can already use (ignoring `exceptId`). */
export function slugTaken(userId: number, slug: string, exceptId = 0): boolean {
  return !!db.prepare(`SELECT 1 FROM skills WHERE slug = ? AND id <> ? AND ${VISIBLE}`).get(slug, exceptId, userId);
}

export function countOwnSkills(userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM skills WHERE owner_id = ?").get(userId) as { n: number }).n;
}

export type SkillInput = { slug: string; name: string; emoji: string; description: string; instructions: string };

/** `ownerId` null makes a shared skill (callers check the person is an admin). */
export function createSkill(ownerId: number | null, input: SkillInput): Skill {
  const id = Number(
    db
      .prepare("INSERT INTO skills (owner_id, slug, name, emoji, description, instructions) VALUES (?, ?, ?, ?, ?, ?)")
      .run(ownerId, input.slug, input.name, input.emoji, input.description, input.instructions).lastInsertRowid,
  );
  return db.prepare(`SELECT ${COLUMNS} FROM skills WHERE id = ?`).get(id) as Skill;
}

export function updateSkill(id: number, input: SkillInput) {
  db.prepare(
    "UPDATE skills SET slug = ?, name = ?, emoji = ?, description = ?, instructions = ?, updated_at = unixepoch() WHERE id = ?",
  ).run(input.slug, input.name, input.emoji, input.description, input.instructions, id);
}

export function deleteSkill(id: number) {
  db.prepare("DELETE FROM skills WHERE id = ?").run(id);
}

/** Who may change a skill: its owner, or any admin for a shared one. */
export function canEditSkill(user: { id: number; is_admin: number }, skill: Skill): boolean {
  return skill.owner_id === null ? !!user.is_admin : skill.owner_id === user.id;
}

// ---- pinned to chats and projects ------------------------------------------------

function idsFrom(table: "conversation_skills" | "project_skills", column: string, id: number): number[] {
  return (db.prepare(`SELECT skill_id FROM ${table} WHERE ${column} = ?`).all(id) as { skill_id: number }[]).map((r) => r.skill_id);
}

/** Skills pinned to one of this person's chats. */
export function conversationSkillIds(userId: number, conversationId: number): number[] {
  const own = db.prepare("SELECT 1 FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, userId);
  return own ? idsFrom("conversation_skills", "conversation_id", conversationId) : [];
}

export function projectSkillIds(userId: number, projectId: number): number[] {
  const own = db.prepare("SELECT 1 FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId);
  return own ? idsFrom("project_skills", "project_id", projectId) : [];
}

type PinTarget = { conversationId: number } | { projectId: number };

/** Replace the skills pinned to a chat or project the caller has checked is this person's. Unusable ids are ignored. */
export function setPinnedSkills(userId: number, target: PinTarget, skillIds: number[]) {
  transaction(() => replacePinnedSkills(userId, target, skillIds));
}

/** setPinnedSkills for callers already inside a transaction (SQLite can't nest them). */
export function replacePinnedSkills(userId: number, target: PinTarget, skillIds: number[]) {
  const [table, column, id] =
    "conversationId" in target
      ? (["conversation_skills", "conversation_id", target.conversationId] as const)
      : (["project_skills", "project_id", target.projectId] as const);
  db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(id);
  for (const skillId of new Set(skillIds)) {
    if (getSkill(userId, skillId)) db.prepare(`INSERT OR IGNORE INTO ${table} (${column}, skill_id) VALUES (?, ?)`).run(id, skillId);
  }
}

/** The skills one message uses: pinned to its chat, pinned to its project, picked for a new chat, and a /slug. */
export function skillsForMessage(
  userId: number,
  opts: { conversationId: number | null; projectId: number | null; extraIds?: number[]; slug?: string | null },
): Skill[] {
  const ids = new Set([
    ...(opts.conversationId ? conversationSkillIds(userId, opts.conversationId) : []),
    ...(opts.projectId ? projectSkillIds(userId, opts.projectId) : []),
    ...(opts.extraIds ?? []),
  ]);
  const skills = [...ids].map((id) => getSkill(userId, id)).filter((s): s is Skill => !!s);
  const slashed = opts.slug ? findSkillBySlug(userId, opts.slug) : undefined;
  if (slashed && !ids.has(slashed.id)) skills.push(slashed);
  return skills;
}
