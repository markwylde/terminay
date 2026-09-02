import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createJsonlRecordDecoder } from "@terminay/extension-api";
import { createCursorAgentProvider, cursorModelDisplayName, cursorPromptText } from "../dist/index.js";

const sessionId = "3afa9283-d72b-42e2-84fd-c445d0c45c3a";

test("Cursor v0.1 maps only allowlisted lifecycle facts and unwraps the user prompt", async () => {
  const fixture = await createCursorFixture();
  try {
    const observed = await createCursorAgentProvider({ cursorHome: fixture.cursorHome, pollMs: 1 }).observe(fixture.terminal);
    assert.equal(observed.state, "bound");
    assert.equal(observed.binding.providerSessionId, sessionId);
    assert.equal(fixture.bindingRequest?.fingerprint.kind, "writable-file-below-terminal-process");

    const watcher = await observed.source;
    const iterator = watcher[Symbol.asyncIterator]();
    const records = [];
    const decoder = createJsonlRecordDecoder();
    while (records.length < 4) {
      const item = await iterator.next();
      assert.equal(item.done, false);
      records.push(...decoder.push(item.value.bytes, item.value.type !== "append"));
    }
    watcher.dispose();

    const events = [];
    const publisher = publisherFor(events);
    for (const record of records) await observed.mapRecord(record, { binding: observed.binding, publish: publisher, signal: fixture.terminal.signal });
    assert.deepEqual(events.map((event) => event.kind), [
      "agent.metadata", "session.started", "turn.started", "turn.started", "agent.done",
    ]);
    assert.equal(events[1].title, "Cursor Session Title");
    assert.deepEqual(events[1].model, { id: "grok-4.6", displayName: "Grok 4.6" });
    assert.equal(events[2].promptText, "Inspect Cursor support");
    assert.equal(events.at(-1).outcome, "success");
    assert.equal(JSON.stringify(events).includes("Private response"), false);
    assert.equal(JSON.stringify(events).includes("private"), false);
  } finally {
    await fixture.cleanup();
  }
});

test("Cursor title and read-only model metadata refresh without changing agent state", async () => {
  const fixture = await createCursorFixture();
  try {
    const observed = await createCursorAgentProvider({ cursorHome: fixture.cursorHome, pollMs: 1 }).observe(fixture.terminal);
    assert.equal(observed.state, "bound");
    const watcher = await observed.source;
    const iterator = watcher[Symbol.asyncIterator]();
    const decoder = createJsonlRecordDecoder();
    const first = await iterator.next();
    const metadata = decoder.push(first.value.bytes);
    const events = [];
    await observed.mapRecord(metadata[0], { binding: observed.binding, publish: publisherFor(events), signal: fixture.terminal.signal });
    assert.deepEqual(events[0], {
      kind: "agent.metadata",
      title: "Cursor Session Title",
      model: { id: "grok-4.6", displayName: "Grok 4.6" },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(fixture.metadataPath, JSON.stringify({ cwd: fixture.cwd, title: "Renamed Cursor Session" }));
    const database = new DatabaseSync(fixture.storePath);
    database.prepare("UPDATE meta SET value = ? WHERE key = ?").run(
      Buffer.from(JSON.stringify({ lastUsedModel: "grok-4.7" })).toString("hex"),
      "0",
    );
    database.close();
    let refreshed;
    for (let attempt = 0; attempt < 20 && !refreshed; attempt += 1) {
      const item = await iterator.next();
      const next = decoder.push(item.value.bytes, item.value.type !== "append");
      refreshed = next.find((record) => record?.type === "terminay.cursor_metadata");
    }
    await observed.mapRecord(refreshed, { binding: observed.binding, publish: publisherFor(events), signal: fixture.terminal.signal });
    assert.deepEqual(events.at(-1), {
      kind: "agent.metadata",
      title: "Renamed Cursor Session",
      model: { id: "grok-4.7", displayName: "Grok 4.7" },
    });
    watcher.dispose();
  } finally {
    await fixture.cleanup();
  }
});

test("Cursor model labels and prompt fallbacks are bounded and display safe", () => {
  assert.equal(cursorModelDisplayName("grok-4.6"), "Grok 4.6");
  assert.equal(cursorPromptText({ role: "user", message: { content: [{ type: "text", text: "plain prompt" }] } }), "plain prompt");
  assert.equal(cursorPromptText({ role: "user", message: { content: [{ type: "text", text: "<timestamp>ignored</timestamp><user_query>actual prompt</user_query>" }] } }), "actual prompt");
});

async function createCursorFixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-cursor-"));
  const cursorHome = join(root, "cursor");
  const cwd = join(root, "project");
  const chat = join(cursorHome, "chats", "workspace-hash", sessionId);
  const canonicalCwd = await mkdir(cwd, { recursive: true }).then(() => realpath(cwd));
  const projectKey = canonicalCwd.replace(/^\/+/, "").replaceAll("/", "-");
  const transcript = join(cursorHome, "projects", projectKey, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
  const store = join(chat, "store.db");
  await mkdir(chat, { recursive: true });
  await mkdir(join(transcript, ".."), { recursive: true });
  await writeFile(join(chat, "meta.json"), JSON.stringify({ cwd, title: "Cursor Session Title" }));
  const database = new DatabaseSync(store);
  database.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  database.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("0", Buffer.from(JSON.stringify({ lastUsedModel: "grok-4.6" })).toString("hex"));
  database.close();
  await writeFile(transcript, [
    JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "<timestamp>Monday</timestamp><user_query>Inspect Cursor support</user_query>" }] } }),
    JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "Private response" }] } }),
    JSON.stringify({ type: "turn_ended", status: "success" }),
    "",
  ].join("\n"));

  const storeHandle = { id: "fixture-store" };
  let binding;
  let bindingRequest;
  const terminal = {
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    foreground: { executableName: "agent" },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "process" }, executableName: "agent" }]; },
        async openFiles() { return [{ handle: storeHandle, path: store, access: "writable" }]; },
      },
      files: {
        async canonicalFile(handle) { return handle === storeHandle ? handle : undefined; },
      },
    },
    async bindSession(request) {
      bindingRequest = request;
      binding = { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion };
      return binding;
    },
  };
  return {
    cursorHome,
    terminal,
    cwd,
    metadataPath: join(chat, "meta.json"),
    storePath: store,
    get binding() { return binding; },
    get bindingRequest() { return bindingRequest; },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function publisherFor(events) {
  const publish = (event) => events.push(event);
  return {
    publish,
    sessionStarted: (event) => publish({ kind: "session.started", ...event }),
    metadataChanged: (event) => publish({ kind: "agent.metadata", ...event }),
    turnStarted: (event) => publish({ kind: "turn.started", ...event }),
    toolStarted: (event) => publish({ kind: "tool.started", ...event }),
    toolFinished: (event) => publish({ kind: "tool.finished", ...event }),
    waitStarted: (event) => publish({ kind: "wait.started", ...event }),
    waitFinished: (event) => publish({ kind: "wait.finished", ...event }),
    done: (event) => publish({ kind: "agent.done", ...event }),
    exited: (event) => publish({ kind: "agent.exited", ...event }),
    subagentStarted: (event) => publish({ kind: "subagent.started", ...event }),
    sessionStopped: (event) => publish({ kind: "session.stopped", ...event }),
    subagentDone: (event) => publish({ kind: "subagent.done", ...event }),
  };
}
