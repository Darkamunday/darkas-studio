import "server-only";
import { db, transaction } from "../db";
import { fileTokens } from "./files";
import { replacePinnedSkills } from "./skills";

// Chat projects. Each has an owner, who alone can change it; the owner can share it with chosen
// people, and admins can share one with everyone who has chat. People it's shared with (members)
// start chats of their own in it, using its instructions, files, skills and model. Their chats stay
// private to them. Every query checks one of these: the person owns the project, or can use it.

export type Project = {
  id: number;
  user_id: number;
  /** The owner's username. */
  owner: string;
  name: string;
  emoji: string;
  instructions: string | null;
  /** Model new chats in the project start on, or null for no preference. */
  model: string | null;
  /** Think setting new chats start with: 1 on, 0 off, null no preference. */
  think: number | null;
  /** 1 when shared with everyone who has chat (admins only). */
  everyone: number;
  /** This person's chats in it. */
  chats: number;
  updated_at: number;
};

/** A project as the browser sees it. Shared by server and client code. */
export type ClientProject = {
  id: number;
  name: string;
  emoji: string;
  instructions: string;
  model: string | null;
  think: boolean | null;
  fileIds: number[];
  skillIds: number[];
  /** Names of the project's files and skills, so members (who can't see the owner's) can be shown them. */
  files: { id: number; name: string; tokens: number }[];
  skills: { id: number; name: string; emoji: string }[];
  chats: number;
  /** Whether this person owns it (and so can change it). */
  mine: boolean;
  /** The owner's username, for projects shared with this person. */
  owner: string | null;
  everyone: boolean;
  /** Who it's shared with — only sent to the owner. */
  members: { id: number; username: string }[];
  /** Whether this person was added by name (and so can leave). */
  member: boolean;
};

export function toClientProject(userId: number, p: Project): ClientProject {
  const mine = p.user_id === userId;
  const members = projectMembers(p.id);
  const skills = projectSkills(p.id);
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    instructions: p.instructions ?? "",
    model: p.model,
    think: p.think === null ? null : !!p.think,
    fileIds: projectFileIds(p.id),
    skillIds: skills.map((s) => s.id),
    files: projectFileMeta(p.id),
    skills: skills.map(({ id, name, emoji }) => ({ id, name, emoji })),
    chats: p.chats,
    mine,
    owner: mine ? null : p.owner,
    everyone: !!p.everyone,
    members: mine ? members : [],
    member: members.some((x) => x.id === userId),
  };
}

const COLUMNS = `p.id, p.user_id, u.username AS owner, p.name, p.emoji, p.instructions, p.model, p.think, p.everyone,
  p.updated_at, (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id AND c.user_id = :uid) AS chats`;
const FROM = "FROM projects p JOIN users u ON u.id = p.user_id";
/** Projects this person can use: their own, ones shared with them, and ones shared with everyone. */
const USABLE = `(p.user_id = :uid OR p.everyone = 1
  OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = :uid))`;

/** Every project this person can use: their own first, then shared ones, each by name. */
export function listProjects(userId: number): Project[] {
  return db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE ${USABLE} ORDER BY p.user_id <> :uid, p.name COLLATE NOCASE, p.id`)
    .all({ uid: userId }) as Project[];
}

/** A project this person can use (start and keep chats in). */
export function getProject(userId: number, id: number): Project | undefined {
  return db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE p.id = :id AND ${USABLE}`).get({ uid: userId, id }) as Project | undefined;
}

/** A project this person owns (and so can change). */
export function getOwnProject(userId: number, id: number): Project | undefined {
  return db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE p.id = :id AND p.user_id = :uid`).get({ uid: userId, id }) as
    | Project
    | undefined;
}

export function countProjects(userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?").get(userId) as { n: number }).n;
}

export type ProjectInput = {
  name?: string;
  emoji?: string;
  instructions?: string | null;
  model?: string | null;
  think?: boolean | null;
  fileIds?: number[];
  skillIds?: number[];
  /** Who it's shared with (replaces the list). */
  memberIds?: number[];
  /** Share with everyone who has chat. Callers only pass this for admins. */
  everyone?: boolean;
};

export function createProject(userId: number, input: ProjectInput & { name: string }): Project {
  const id = transaction(() => {
    const id = Number(
      db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run(userId, input.name).lastInsertRowid,
    );
    applyUpdate(userId, id, input);
    return id;
  });
  return getOwnProject(userId, id)!;
}

export function updateProject(userId: number, id: number, input: ProjectInput): boolean {
  if (!getOwnProject(userId, id)) return false;
  transaction(() => applyUpdate(userId, id, input));
  return true;
}

function applyUpdate(userId: number, id: number, input: ProjectInput) {
  const set = (column: string, value: string | number | null) =>
    db.prepare(`UPDATE projects SET ${column} = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?`).run(value, id, userId);
  if (input.name !== undefined) set("name", input.name);
  if (input.emoji !== undefined) set("emoji", input.emoji);
  if (input.instructions !== undefined) set("instructions", input.instructions?.trim() || null);
  if (input.model !== undefined) set("model", input.model);
  if (input.think !== undefined) set("think", input.think === null ? null : input.think ? 1 : 0);
  if (input.everyone !== undefined) set("everyone", input.everyone ? 1 : 0);
  if (input.fileIds !== undefined) {
    db.prepare("DELETE FROM project_files WHERE project_id = ?").run(id);
    const add = db.prepare(
      "INSERT OR IGNORE INTO project_files (project_id, file_id) SELECT ?, id FROM chat_files WHERE id = ? AND user_id = ?",
    );
    for (const fileId of new Set(input.fileIds)) add.run(id, fileId, userId);
  }
  if (input.skillIds !== undefined) replacePinnedSkills(userId, { projectId: id }, input.skillIds);
  if (input.memberIds !== undefined) {
    db.prepare("DELETE FROM project_members WHERE project_id = ?").run(id);
    // Only people who could use it: not the owner, and not disabled.
    const add = db.prepare(
      "INSERT OR IGNORE INTO project_members (project_id, user_id) SELECT ?, id FROM users WHERE id = ? AND id <> ? AND disabled = 0",
    );
    for (const memberId of new Set(input.memberIds)) add.run(id, memberId, userId);
  }
  if (input.memberIds !== undefined || input.everyone !== undefined) releaseChats(id);
}

/**
 * Chats in a project whose people can no longer use it (taken off the list, or it stopped being
 * shared with everyone) move back to their main lists, as when a project is deleted.
 */
function releaseChats(projectId: number) {
  db.prepare(
    `UPDATE conversations SET project_id = NULL
      WHERE project_id = :id
        AND user_id <> (SELECT user_id FROM projects WHERE id = :id)
        AND NOT (SELECT everyone FROM projects WHERE id = :id)
        AND user_id NOT IN (SELECT user_id FROM project_members WHERE project_id = :id)`,
  ).run({ id: projectId });
}

/** Delete a project. Its chats (everyone's) stay, moved back to the main list (the foreign key sets them loose). */
export function deleteProject(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Take yourself off a project shared with you; your chats in it move back to your main list. */
export function leaveProject(userId: number, id: number): boolean {
  return transaction(() => {
    const left = db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(id, userId).changes > 0;
    if (left) releaseChats(id);
    return left;
  });
}

function projectMembers(projectId: number): { id: number; username: string }[] {
  // Copied into plain objects: these go to the browser, and SQLite rows can't be passed to client components.
  return (
    db
      .prepare(
        `SELECT u.id, u.username FROM project_members pm JOIN users u ON u.id = pm.user_id
          WHERE pm.project_id = ? ORDER BY u.username COLLATE NOCASE`,
      )
      .all(projectId) as { id: number; username: string }[]
  ).map(({ id, username }) => ({ id, username }));
}

/** People a project can be shared with: everyone else with chat who isn't disabled. */
export function shareablePeople(userId: number): { id: number; username: string }[] {
  return db
    .prepare(
      `SELECT id, username FROM users
        WHERE id <> ? AND disabled = 0 AND (is_admin = 1 OR chat_enabled = 1)
        ORDER BY username COLLATE NOCASE`,
    )
    .all(userId) as { id: number; username: string }[];
}

// The project's files and skills. Callers have already checked the person can use the project;
// these are the owner's, so they're read by project, not by person.

export function projectFileIds(projectId: number): number[] {
  return (db.prepare("SELECT file_id FROM project_files WHERE project_id = ?").all(projectId) as { file_id: number }[]).map(
    (r) => r.file_id,
  );
}

function projectFileMeta(projectId: number): ClientProject["files"] {
  return (
    db
      .prepare(
        `SELECT f.id, f.name, length(f.text) AS chars FROM project_files pf JOIN chat_files f ON f.id = pf.file_id
          WHERE pf.project_id = ? ORDER BY f.name COLLATE NOCASE, f.id`,
      )
      .all(projectId) as { id: number; name: string; chars: number }[]
  ).map((f) => ({ id: f.id, name: f.name, tokens: fileTokens(f.chars) }));
}

export type ProjectSkill = { id: number; name: string; emoji: string; instructions: string };

export function projectSkills(projectId: number): ProjectSkill[] {
  return db
    .prepare(
      `SELECT s.id, s.name, s.emoji, s.instructions FROM project_skills ps JOIN skills s ON s.id = ps.skill_id
        WHERE ps.project_id = ? ORDER BY s.name COLLATE NOCASE`,
    )
    .all(projectId) as ProjectSkill[];
}

/** Move one of your chats into a project you can use, or out (null). */
export function moveConversation(userId: number, conversationId: number, projectId: number | null): boolean {
  if (projectId !== null && !getProject(userId, projectId)) return false;
  return (
    db.prepare("UPDATE conversations SET project_id = ? WHERE id = ? AND user_id = ?").run(projectId, conversationId, userId)
      .changes > 0
  );
}
