import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createJsonlRecordDecoder } from "@terminay/extension-api";
import { createCursorAgentProvider } from "../dist/index.js";

const ids = ["3afa9283-d72b-42e2-84fd-c445d0c45c3a", "a9620de3-6170-442a-bd1c-f972a5db67f9"];

test("two terminals bind the exact Cursor store and resumed UUID without cross-terminal leakage", async () => {
  const left = await cursorFixture(ids[0], "Left Cursor", "grok-4.6", "left prompt");
  const right = await cursorFixture(ids[1], "Resumed Cursor", "claude-4.5-sonnet", "right prompt");
  try {
    const [leftObserved, rightObserved] = await Promise.all([
      createCursorAgentProvider({ cursorHome: left.cursorHome, pollMs: 1 }).observe(left.terminal),
      createCursorAgentProvider({ cursorHome: right.cursorHome, pollMs: 1 }).observe(right.terminal),
    ]);
    assert.equal(leftObserved.state, "bound");
    assert.equal(rightObserved.state, "bound");
    assert.equal(leftObserved.binding.providerSessionId, ids[0]);
    assert.equal(rightObserved.binding.providerSessionId, ids[1]);
    const leftEvents = await firstRecords(leftObserved, 3);
    const rightEvents = await firstRecords(rightObserved, 3);
    assert.equal(JSON.stringify(leftEvents).includes("left prompt"), true);
    assert.equal(JSON.stringify(leftEvents).includes("right prompt"), false);
    assert.equal(JSON.stringify(rightEvents).includes("right prompt"), true);
    assert.equal(JSON.stringify(rightEvents).includes("left prompt"), false);
  } finally { await Promise.all([left.cleanup(), right.cleanup()]); }
});

test("Cursor title and model renames publish metadata while preserving the bound UUID and lifecycle", async () => {
  const fixture = await cursorFixture(ids[0], "Before", "grok-4.6", "keep working");
  try {
    const observed = await createCursorAgentProvider({ cursorHome: fixture.cursorHome, pollMs: 1 }).observe(fixture.terminal);
    assert.equal(observed.state, "bound");
    const binding = observed.binding;
    const watcher = await observed.source;
    const iterator = watcher[Symbol.asyncIterator]();
    const decoder = createJsonlRecordDecoder();
    await iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(fixture.metadataPath, JSON.stringify({ cwd: fixture.cwd, title: "After" }));
    const database = new DatabaseSync(fixture.storePath);
    database.prepare("UPDATE meta SET value = ? WHERE key = ?").run(Buffer.from(JSON.stringify({ lastUsedModel: "grok-4.7" })).toString("hex"), "0");
    database.close();
    let metadata;
    for (let attempt = 0; attempt < 30 && !metadata; attempt += 1) {
      const item = await iterator.next();
      metadata = decoder.push(item.value.bytes, item.value.type !== "append").find((record) => record?.type === "terminay.cursor_metadata" && record.title === "After");
    }
    const events = [];
    await observed.mapRecord(metadata, { binding, publish: publisher(events), signal: fixture.terminal.signal });
    watcher.dispose();
    assert.equal(observed.binding, binding);
    assert.equal(observed.binding.providerSessionId, ids[0]);
    assert.deepEqual(events, [{ kind: "agent.metadata", title: "After", model: { id: "grok-4.7", displayName: "Grok 4.7" } }]);
  } finally { await fixture.cleanup(); }
});

async function firstRecords(observed, count) {
  const watcher = await observed.source;
  const iterator = watcher[Symbol.asyncIterator]();
  const decoder = createJsonlRecordDecoder();
  const records = [];
  while (records.length < count) { const item = await iterator.next(); records.push(...decoder.push(item.value.bytes, item.value.type !== "append")); }
  watcher.dispose();
  const events = [];
  for (const record of records) await observed.mapRecord(record, { binding: observed.binding, publish: publisher(events), signal: { aborted: false, throwIfAborted() {} } });
  return events;
}

function publisher(events) {
  const emit = (event) => events.push(event);
  const kinds = { sessionStarted: "session.started", metadataChanged: "agent.metadata", turnStarted: "turn.started", toolStarted: "tool.started", toolFinished: "tool.finished", waitStarted: "wait.started", waitFinished: "wait.finished", done: "agent.done", exited: "agent.exited", subagentStarted: "subagent.started", subagentDone: "subagent.done" };
  return new Proxy({ publish: emit }, { get(target, name) { return name in target ? target[name] : (event) => emit({ kind: kinds[name], ...event }); } });
}

async function cursorFixture(sessionId, title, model, prompt) {
  const root = await mkdtemp(join(tmpdir(), "terminay-cursor-compound-"));
  const cursorHome = join(root, "cursor");
  const cwd = join(root, "project");
  const chat = join(cursorHome, "chats", "workspace", sessionId);
  const canonicalCwd = await mkdir(cwd, { recursive: true }).then(() => realpath(cwd));
  const key = canonicalCwd.replace(/^\/+/, "").replaceAll("/", "-");
  const transcriptPath = join(cursorHome, "projects", key, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
  const storePath = join(chat, "store.db");
  const metadataPath = join(chat, "meta.json");
  await mkdir(chat, { recursive: true }); await mkdir(join(transcriptPath, ".."), { recursive: true });
  await writeFile(metadataPath, JSON.stringify({ cwd, title }));
  const database = new DatabaseSync(storePath); database.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  database.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("0", Buffer.from(JSON.stringify({ lastUsedModel: model })).toString("hex")); database.close();
  await writeFile(transcriptPath, [JSON.stringify({ role: "user", message: { content: [{ type: "text", text: prompt }] } }), JSON.stringify({ type: "turn_ended", status: "success" }), ""].join("\n"));
  const storeHandle = { id: `store-${sessionId}` };
  const terminal = {
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]), signal: { aborted: false, throwIfAborted() {} }, foreground: { executableName: "agent" },
    observation: { processes: { async descendants() { return [{ handle: { id: `process-${sessionId}` }, executableName: "agent" }]; }, async openFiles() { return [{ handle: storeHandle, path: storePath, access: "writable" }]; } }, files: { async canonicalFile(handle) { return handle === storeHandle ? handle : undefined; } } },
    async bindSession(request) { return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion }; },
  };
  return { cursorHome, cwd, storePath, metadataPath, terminal, cleanup: () => rm(root, { recursive: true, force: true }) };
}
