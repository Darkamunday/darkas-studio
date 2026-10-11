// Chat projects shared with people: who can see, use and change them, and what members' chats get.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import * as P from "@/lib/chat/projects";
import { filesForChat } from "@/lib/chat/files";
import { createSkill, skillsForMessage } from "@/lib/chat/skills";
import { assertPlain, makeConversation, makeFile, makeUser } from "./helpers";

const projectOf = (conversationId: number) =>
  (db.prepare("SELECT project_id FROM conversations WHERE id = ?").get(conversationId) as { project_id: number | null }).project_id;

test("members can use a shared project but not change it", () => {
  const owner = makeUser(), member = makeUser(), other = makeUser();
  const p = P.createProject(owner, { name: "Test Project", memberIds: [member] });
  assert.ok(P.getProject(member, p.id));
  assert.equal(P.getProject(other, p.id), undefined);
  assert.equal(P.updateProject(member, p.id, { name: "changed" }), false);
  assert.equal(P.deleteProject(member, p.id), false);
  assert.equal(P.getProject(owner, p.id)!.name, "Test Project");
});

test("members see the owner's name and the project's files and skills, but not the member list", () => {
  const owner = makeUser("test_owner_a"), member = makeUser();
  const file = makeFile(owner);
  const skill = createSkill(owner, { slug: "test-skill", name: "Test Skill", emoji: "✦", description: "", instructions: "Do X" });
  const p = P.createProject(owner, { name: "Test", memberIds: [member], fileIds: [file], skillIds: [skill.id] });
  const seen = P.toClientProject(member, P.getProject(member, p.id)!);
  assert.equal(seen.mine, false);
  assert.equal(seen.owner, "test_owner_a");
  assert.equal(seen.member, true);
  assert.deepEqual(seen.members, []);
  assert.deepEqual(seen.files.map((f) => f.id), [file]);
  assert.deepEqual(seen.skills.map((s) => s.id), [skill.id]);
  assertPlain(seen);
  assertPlain(P.listProjects(owner).map((x) => P.toClientProject(owner, x)));
});

test("members' chats get the owner's project files and private skills; others get nothing", () => {
  const owner = makeUser(), member = makeUser(), other = makeUser();
  const file = makeFile(owner, "Test Notes.md", "secret-ish notes");
  const skill = createSkill(owner, { slug: "own-skill", name: "Own Skill", emoji: "✦", description: "", instructions: "Do Y" });
  const p = P.createProject(owner, { name: "Test", memberIds: [member], fileIds: [file], skillIds: [skill.id] });
  assert.ok(filesForChat(member, null, [], p.id).some((f) => f.id === file));
  assert.ok(skillsForMessage(member, { conversationId: null, projectId: p.id }).some((s) => s.id === skill.id));
  assert.equal(filesForChat(other, null, [], null).length, 0);
});

test("chat counts are per person, and nobody can move someone else's chat", () => {
  const owner = makeUser(), member = makeUser(), other = makeUser();
  const p = P.createProject(owner, { name: "Test", memberIds: [member] });
  const chat = makeConversation(member, p.id);
  assert.equal(P.listProjects(member).find((x) => x.id === p.id)!.chats, 1);
  assert.equal(P.listProjects(owner).find((x) => x.id === p.id)!.chats, 0);
  assert.equal(P.moveConversation(other, chat, null), false);
  assert.equal(P.moveConversation(other, makeConversation(other), p.id), false);
});

test("taking someone off, leaving, or ending 'everyone' moves their chats back to their main list", () => {
  const owner = makeUser(), a = makeUser(), b = makeUser(), admin = makeUser("test_admin", { admin: true });
  const p = P.createProject(owner, { name: "Test", memberIds: [a, b] });
  const aChat = makeConversation(a, p.id), bChat = makeConversation(b, p.id), ownChat = makeConversation(owner, p.id);
  P.updateProject(owner, p.id, { memberIds: [b] });
  assert.equal(P.getProject(a, p.id), undefined);
  assert.equal(projectOf(aChat), null);
  assert.equal(projectOf(ownChat), p.id);
  assert.ok(P.leaveProject(b, p.id));
  assert.equal(projectOf(bChat), null);

  const everyone = P.createProject(admin, { name: "Everyone", everyone: true });
  const outsiderChat = makeConversation(a, everyone.id);
  assert.ok(P.getProject(a, everyone.id));
  P.updateProject(admin, everyone.id, { everyone: false });
  assert.equal(P.getProject(a, everyone.id), undefined);
  assert.equal(projectOf(outsiderChat), null);
});

test("the owner, unknown ids and disabled accounts can't be members", () => {
  const owner = makeUser(), a = makeUser(), disabled = makeUser();
  db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(disabled);
  const p = P.createProject(owner, { name: "Test", memberIds: [a, owner, disabled, 999999] });
  assert.deepEqual(P.toClientProject(owner, P.getOwnProject(owner, p.id)!).members.map((m) => m.id), [a]);
  assert.ok(P.shareablePeople(owner).every((x) => x.id !== owner && x.id !== disabled));
});
