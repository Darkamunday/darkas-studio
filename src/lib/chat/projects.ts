import "server-only";
import { db, transaction } from "../db";
import { projectSkillIds, replacePinnedSkills } from "./skills";

// Each person's chat projects. Every query is scoped to the owner.

export type Project = {
  id: number;
  name: string;
  emoji: string;
  instructions: string | null;
  /** Model new chats in the project start on, or null for no preference. */
  model: string | null;
  /** Think setting new chats start with: 1 on, 0 off, null no preference. */
  think: number | null;
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
  chats: number;
};

export function toClientProject(userId: number, p: Project): ClientProject {
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    instructions: p.instructions ?? "",
    model: p.model,
    think: p.think === null ? null : !!p.think,
    fileIds: projectFileIds(userId, p.id),
    skillIds: projectSkillIds(userId, p.id),
    chats: p.chats,
  };
}

const COLUMNS = `p.id, p.name, p.emoji, p.instructions, p.model, p.think, p.updated_at,
  (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) AS chats`;

export function listProjects(userId: number): Project[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM projects p WHERE p.user_id = ? ORDER BY p.name COLLATE NOCASE, p.id`)
    .all(userId) as Project[];
}

export function getProject(userId: number, id: number): Project | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM projects p WHERE p.id = ? AND p.user_id = ?`).get(id, userId) as Project | undefined;
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
};

export function createProject(userId: number, input: ProjectInput & { name: string }): Project {
  const id = transaction(() => {
    const id = Number(
      db.prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)").run(userId, input.name).lastInsertRowid,
    );
    applyUpdate(userId, id, input);
    return id;
  });
  return getProject(userId, id)!;
}

export function updateProject(userId: number, id: number, input: ProjectInput): boolean {
  if (!getProject(userId, id)) return false;
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
  if (input.fileIds !== undefined) {
    db.prepare("DELETE FROM project_files WHERE project_id = ?").run(id);
    const add = db.prepare(
      "INSERT OR IGNORE INTO project_files (project_id, file_id) SELECT ?, id FROM chat_files WHERE id = ? AND user_id = ?",
    );
    for (const fileId of new Set(input.fileIds)) add.run(id, fileId, userId);
  }
  if (input.skillIds !== undefined) replacePinnedSkills(userId, { projectId: id }, input.skillIds);
}

/** Delete a project. Its chats stay, moved back to the main list (the foreign key sets them loose). */
export function deleteProject(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function projectFileIds(userId: number, projectId: number): number[] {
  return (
    db
      .prepare(
        `SELECT pf.file_id FROM project_files pf JOIN projects p ON p.id = pf.project_id
          WHERE pf.project_id = ? AND p.user_id = ?`,
      )
      .all(projectId, userId) as { file_id: number }[]
  ).map((r) => r.file_id);
}

/** Move one of your chats into one of your projects, or out (null). */
export function moveConversation(userId: number, conversationId: number, projectId: number | null): boolean {
  if (projectId !== null && !getProject(userId, projectId)) return false;
  return (
    db.prepare("UPDATE conversations SET project_id = ? WHERE id = ? AND user_id = ?").run(projectId, conversationId, userId)
      .changes > 0
  );
}
