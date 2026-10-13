// Adult (18+) chats: who can use them, and that they stay out of projects, songs, memory and shared albums.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import * as AD from "@/lib/chat/adult";
import * as P from "@/lib/chat/projects";
import * as A from "@/lib/albums";
import * as PA from "@/lib/picture-albums";
import { createConversation } from "@/lib/chat/store";
import { getSongDraft } from "@/lib/chat/song-draft";
import { streamOpenRouter, toMessages } from "@/lib/chat/openrouter";
import { OllamaError } from "@/lib/chat/ollama";
import { ADULT_MODELS, ADULT_RULES, CHAT_MODELS, findAdultModel, findAnyModel, findChatModel } from "@/config/chat";
import { makeChatImage, makeMessage, makeUser } from "./helpers";

test("off by default; needs an admin's switch, an OpenRouter key and the person's 18+ confirmation", () => {
  const a = makeUser();
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(AD.adultAccess(a), "off");
  assert.equal(AD.confirmAdult(a), false, "can't confirm before being switched on");
  AD.setAdultEnabled(a, true);
  assert.equal(AD.adultAccess(a), "off", "no key, no adult chats");
  process.env.OPENROUTER_API_KEY = "test-key";
  assert.equal(AD.adultAccess(a), "confirm");
  assert.ok(AD.confirmAdult(a));
  assert.equal(AD.adultAccess(a), "on");
  AD.setAdultEnabled(a, false);
  assert.equal(AD.adultAccess(a), "off");
  AD.setAdultEnabled(a, true);
  assert.equal(AD.adultAccess(a), "confirm", "switching off clears the confirmation");
});

test("adult models are separate from the ordinary ones, and all run on OpenRouter", () => {
  assert.ok(ADULT_MODELS.length > 0);
  for (const m of ADULT_MODELS) {
    assert.equal(m.provider, "openrouter");
    assert.equal(findChatModel(m.id), undefined, "never offered in ordinary chats");
    assert.equal(findAnyModel(m.id), m);
  }
  assert.ok(ADULT_MODELS.some((m) => m.tools), "at least one adult model can use tools");
  for (const m of CHAT_MODELS) assert.equal(findAdultModel(m.id), undefined);
  for (const rule of ["under 18", "real, identifiable people", "non-consent"]) assert.ok(ADULT_RULES.includes(rule));
});

test("adult chats never go in a project, and can't be moved into one", () => {
  const owner = makeUser(), a = makeUser();
  const p = P.createProject(owner, { name: "Test", memberIds: [a] });
  const chat = createConversation(a, ADULT_MODELS[0].id, p.id, true);
  assert.equal((db.prepare("SELECT project_id, adult FROM conversations WHERE id = ?").get(chat) as { project_id: number | null; adult: number }).project_id, null);
  assert.ok(AD.isAdultConversation(a, chat));
  assert.equal(P.moveConversation(a, chat, p.id), false);
  assert.ok(P.moveConversation(a, chat, null));
  assert.ok(P.moveConversation(a, createConversation(a, "m", null), p.id), "ordinary chats still can");
});

test("no song drafts from adult chats (they're made on Ollama Cloud)", () => {
  const a = makeUser();
  const adultChat = createConversation(a, ADULT_MODELS[0].id, null, true);
  const normalChat = createConversation(a, "m", null);
  const draft = JSON.stringify({ title: "Test Song", style: "pop", lyrics: "la la" });
  const inAdult = makeMessage(adultChat, "assistant", "text");
  const inNormal = makeMessage(normalChat, "assistant", "text");
  db.prepare("UPDATE messages SET song_draft = ? WHERE id IN (?, ?)").run(draft, inAdult, inNormal);
  assert.equal(getSongDraft(a, inAdult), null);
  assert.ok(getSongDraft(a, inNormal));
});

test("adult pictures only go in your own private albums, and are never shown to anyone else", async () => {
  const owner = makeUser(), member = makeUser();
  const adultPic = makeChatImage(owner, createConversation(owner, ADULT_MODELS[0].id, null, true));
  const shared = A.createAlbum(owner, { name: "Shared", kind: "pictures", memberIds: [member] });
  const priv = A.createAlbum(owner, { name: "Private", kind: "pictures" });
  assert.deepEqual(PA.albumsForImage(owner, adultPic).map((c) => c.id), [priv.id]);
  assert.equal(await PA.addPicture(owner, shared.id, adultPic), "not_found");
  assert.equal(await PA.addPicture(owner, priv.id, adultPic), "added");
  const [pic] = PA.albumPictures(owner, priv.id)!;
  // Sharing the album later still doesn't show it to others.
  A.updateAlbum(owner, priv.id, { memberIds: [member] });
  assert.deepEqual(PA.albumPictures(member, priv.id), []);
  assert.equal(PA.pictureFile(member, pic.id), undefined);
  assert.equal(A.getAlbum(member, priv.id)!.itemCount, 0);
  assert.equal(A.getAlbum(member, priv.id)!.coverUrl, null);
  assert.ok(PA.pictureFile(owner, pic.id), "still the owner's");
});

test("OpenRouter client: asks for no data collection, streams text and usage, maps errors", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const realFetch = globalThis.fetch;
  let sent: { body: Record<string, unknown>; auth: string | null } | null = null;
  const sse = (lines: string[]) =>
    new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); } }), { status: 200 });
  try {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = { body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") };
      return sse([
        ": OPENROUTER PROCESSING\n\n",
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        '\ndata: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
        "data: [DONE]\n\n",
      ]);
    }) as typeof fetch;
    let text = "";
    let usage: { input: number; output: number } | null = null;
    for await (const p of streamOpenRouter({ model: ADULT_MODELS[0].id, messages: [{ role: "user", content: "hi" }], maxTokens: 100, onUsage: (u) => (usage = u) })) {
      if (p.kind === "text") text += p.text;
    }
    assert.equal(text, "Hello");
    assert.deepEqual(usage, { input: 12, output: 3 });
    assert.deepEqual(sent!.body.provider, { data_collection: "deny" });
    assert.equal(sent!.auth, "Bearer test-key");

    globalThis.fetch = (async () => new Response("no credit", { status: 402 })) as typeof fetch;
    await assert.rejects(
      (async () => { for await (const _ of streamOpenRouter({ model: "x", messages: [], maxTokens: 1 })) void _; })(),
      (e: OllamaError) => e.reason === "no_credit",
    );
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(
      (async () => { for await (const _ of streamOpenRouter({ model: "x", messages: [], maxTokens: 1 })) void _; })(),
      (e: OllamaError) => e.reason === "not_configured",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("tool calls: turns are converted to OpenAI's format with matching ids", () => {
  const out = toMessages([
    { role: "system", content: "sys" },
    { role: "user", content: "make two" },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "a", arguments: { x: 1 } } }, { function: { name: "b", arguments: {} } }] },
    { role: "tool", content: "result a", tool_name: "a" },
    { role: "tool", content: "result b", tool_name: "b" },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "c", arguments: { y: "z" } } }] },
    { role: "tool", content: "result c", tool_name: "c" },
    { role: "tool", content: "orphan", tool_name: "d" },
  ]);
  const calls = out.flatMap((m) => (m.role === "assistant" && m.tool_calls ? m.tool_calls : []));
  const results = out.filter((m) => m.role === "tool") as { tool_call_id: string; content: string }[];
  assert.deepEqual(calls.map((c) => c.function.name), ["a", "b", "c"]);
  assert.equal(calls[0].function.arguments, '{"x":1}');
  assert.deepEqual(results.map((r) => r.tool_call_id), calls.map((c) => c.id), "each result points at its call");
  for (const c of calls) assert.match(c.id, /^[a-zA-Z0-9]{9}$/, "ids must be exactly 9 letters/digits (Mistral's rule)");
  assert.equal(results.length, 3, "a result with no call is dropped");
});

test("tool calls stream in pieces and come out whole", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const realFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  try {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      const lines = [
        'data: {"choices":[{"delta":{"content":"On it. "}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x1","function":{"name":"generate_image","arguments":"{\\"pro"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"mpt\\":\\"a test\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"x2","function":{"name":"load_tools","arguments":"{}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ];
      return new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); } }));
    }) as typeof fetch;
    const tools = [{ type: "function" as const, function: { name: "generate_image", description: "d", parameters: {} } }];
    const pieces = [];
    for await (const p of streamOpenRouter({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 10, tools })) pieces.push(p);
    assert.deepEqual(body.tools, tools, "tools are sent");
    assert.equal(body.reasoning, undefined, "no Think setting unless asked");
    assert.deepEqual(
      pieces.filter((p) => p.kind === "tool_call").map((p) => (p.kind === "tool_call" ? p.call.function : null)),
      [
        { name: "generate_image", arguments: { prompt: "a test" } },
        { name: "load_tools", arguments: {} },
      ],
    );
    assert.ok(pieces.some((p) => p.kind === "text" && p.text === "On it. "));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENROUTER_API_KEY;
  }
});

test("the Think toggle is passed to OpenRouter as reasoning", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const realFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  try {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning":"hmm","content":"ok"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }));
    }) as typeof fetch;
    const pieces = [];
    for await (const p of streamOpenRouter({ model: "m", messages: [], maxTokens: 1, think: true })) pieces.push(p);
    for await (const _ of streamOpenRouter({ model: "m", messages: [], maxTokens: 1, think: false })) void _;
    assert.deepEqual(bodies.map((b) => b.reasoning), [{ enabled: true }, { enabled: false }]);
    assert.ok(pieces.some((p) => p.kind === "thinking" && p.text === "hmm"), "reasoning is shown as thinking");
    const adultDefault = ADULT_MODELS[0];
    assert.ok(adultDefault.tools && adultDefault.thinking, "the default adult model has tools and Think");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENROUTER_API_KEY;
  }
});
