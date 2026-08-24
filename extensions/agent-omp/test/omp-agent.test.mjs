import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOmpRecordMapper, isOmpForeground, ompAgentProvider, ompJournalRelativeRoots, resolveLocalOmpJournalRoots } from "../dist/index.js";

function publisher(events) {
  const emit = (event) => events.push(event);
  return {
    publish: emit,
    sessionStarted: (event) => emit({ kind: "session.started", ...event }),
    metadataChanged: (event) => emit({ kind: "agent.metadata", ...event }),
    turnStarted: (event) => emit({ kind: "turn.started", ...event }),
    toolStarted: (event) => emit({ kind: "tool.started", ...event }),
    toolFinished: (event) => emit({ kind: "tool.finished", ...event }),
    done: (event) => emit({ kind: "agent.done", ...event }),
    subagentStarted: (event) => emit({ kind: "subagent.started", ...event }),
    subagentDone: (event) => emit({ kind: "subagent.done", ...event }),
  };
}

async function replay(name, options = {}) {
  const records = (await readFile(new URL(`./fixtures/v0.1/${name}.jsonl`, import.meta.url), "utf8"))
    .trim().split("\n").map(JSON.parse);
  const events = [];
  const map = createOmpRecordMapper(options);
  const session = { binding: { providerSessionId: "omp-root-v01" }, publish: publisher(events), signal: { aborted: false, throwIfAborted() {} } };
  for (const record of records) await map(record, session);
  return events;
}

test("maps OMP root records without exposing private content", async () => {
  const events = await replay("basic", { title: "Fixture OMP session" });
  assert.deepEqual(events.map((event) => event.kind), [
    "session.started", "turn.started", "tool.started", "tool.finished", "tool.started", "agent.done", "session.stopped",
  ]);
  assert.equal(events[0].title, "Fixture OMP session");
  assert.equal(events[1].promptText, "Add OMP journal support");
  assert.equal(events[2].name, "read");
  assert.equal(events[5].outcome, "success");
  assert.equal(JSON.stringify(events).includes("private tool output"), false);
  assert.equal(JSON.stringify(events).includes("/private/path"), false);
});

test("a replacement title slot updates root metadata without restarting the session", async () => {
  const events = [];
  const map = createOmpRecordMapper({ title: "Before" });
  const session = { binding: { providerSessionId: "root" }, publish: publisher(events), signal: { aborted: false, throwIfAborted() {} } };
  await map({ type: "session", id: "root" }, session);
  await map({ type: "title", title: "After atomic replacement" }, session);
  assert.deepEqual(events, [
    { kind: "session.started", title: "Before" },
    { kind: "agent.metadata", title: "After atomic replacement" },
  ]);
});

test("a title observed before the logical session header is retained in memory and used at start", async () => {
  const events = [];
  const map = createOmpRecordMapper();
  const session = { binding: { providerSessionId: "root" }, publish: publisher(events), signal: { aborted: false, throwIfAborted() {} } };
  await map({ type: "title", title: "Pre-file title" }, session);
  assert.deepEqual(events, []);
  await map({ type: "session", id: "root" }, session);
  assert.deepEqual(events, [{ kind: "session.started", title: "Pre-file title" }]);
});

test("unsupported permission and wait-shaped records never invent waiting lifecycle", async () => {
  const events = [];
  const map = createOmpRecordMapper();
  const session = { binding: { providerSessionId: "root" }, publish: publisher(events), signal: { aborted: false, throwIfAborted() {} } };
  for (const record of [
    { type: "permission_request", id: "request", tool: "write", arguments: { path: "/private" } },
    { type: "custom", customType: "approval_requested", data: { request: "private" } },
    { type: "waiting", reason: "permission" },
  ]) await map(record, session);
  assert.deepEqual(events, []);
});

test("resume and topology rebind follow the exact current PTY breadcrumb", async () => {
  const first = ompObservationFixture("root-one", "First");
  const second = ompObservationFixture("root-two", "Second");
  const [firstResult, secondResult] = await Promise.all([ompAgentProvider.observe(first.terminal), ompAgentProvider.observe(second.terminal)]);
  assert.equal(firstResult.state, "bound");
  assert.equal(secondResult.state, "bound");
  assert.equal(firstResult.binding.providerSessionId, "root-one");
  assert.equal(secondResult.binding.providerSessionId, "root-two");
  assert.notEqual(first.bindingRequest.journal.id, second.bindingRequest.journal.id);
});

test("a malformed breadcrumb and unrelated non-writer journal fail closed", async () => {
  const fixture = ompObservationFixture("root", "No leak", { breadcrumb: "not-a-provider-breadcrumb", writer: false });
  const result = await ompAgentProvider.observe(fixture.terminal);
  assert.equal(result.state, "not-bound");
  assert.equal(fixture.bindingRequest, undefined);
});

test("maps a separately proven OMP child journal with stable child identity", async () => {
  const events = await replay("child", { childAgentId: "child-file-id" });
  assert.deepEqual(events.map((event) => event.kind), ["subagent.started", "turn.started", "subagent.done"]);
  assert.equal(events[0].subagentId, "child-file-id");
  assert.equal(events[1].agentId, "child-file-id");
  assert.equal(events[2].outcome, "cancelled");
});

test("recognises OMP and its specific Bun wrapper without treating arbitrary Bun as OMP", () => {
  assert.equal(isOmpForeground({ executableName: "omp" }), true);
  assert.equal(isOmpForeground({ executableName: "oh-my-pi" }), true);
  assert.equal(isOmpForeground({ executableName: "bun", arguments: ["/opt/omp/index.js"] }), true);
  assert.equal(isOmpForeground({ executableName: "bun", arguments: ["script.ts"] }), false);
  assert.equal(isOmpForeground({ executableName: "node", arguments: ["omp"] }), false);
});

test("declares standard, XDG-data, and XDG-state OMP journal roots", () => {
  assert.deepEqual(ompJournalRelativeRoots(), [
    { sessions: ".omp/agent/sessions", terminalSessions: ".omp/agent/terminal-sessions" },
    { sessions: ".local/share/omp/sessions", terminalSessions: ".local/state/omp/terminal-sessions" },
    { sessions: ".local/state/omp/agent/sessions", terminalSessions: ".local/state/omp/agent/terminal-sessions" },
  ]);
});

test("preserves OMP home, profile, coding-directory, and Linux XDG root precedence", () => {
  assert.deepEqual(resolveLocalOmpJournalRoots({ ompHome: "/omp-home", home: "/home/a" }), [
    { sessions: "/omp-home/agent/sessions", terminalSessions: "/omp-home/agent/terminal-sessions" },
  ]);
  assert.deepEqual(resolveLocalOmpJournalRoots({ home: "/home/a", environment: { OMP_PROFILE: "work" } }), [
    { sessions: "/home/a/.omp/profiles/work/agent/sessions", terminalSessions: "/home/a/.omp/profiles/work/agent/terminal-sessions" },
  ]);
  assert.deepEqual(resolveLocalOmpJournalRoots({ home: "/home/a", environment: { PI_CODING_AGENT_DIR: "/data/omp/agent" } }), [
    { sessions: "/data/omp/agent/sessions", terminalSessions: "/data/omp/agent/terminal-sessions" },
  ]);
  assert.deepEqual(resolveLocalOmpJournalRoots({ home: "/home/a", platform: "linux", environment: { XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state" } }), [
    { sessions: "/home/a/.omp/agent/sessions", terminalSessions: "/home/a/.omp/agent/terminal-sessions" },
    { sessions: "/data/omp/sessions", terminalSessions: "/state/omp/terminal-sessions" },
    { sessions: "/state/omp/sessions", terminalSessions: "/state/omp/terminal-sessions" },
  ]);
});

test("binds the exact PTY breadcrumb and attaches only direct writer-proven child journals", async () => {
  const rootPath = "/home/test/.omp/agent/sessions/project/root.jsonl";
  const childPath = "/home/test/.omp/agent/sessions/project/root/child-file-id.jsonl";
  const breadcrumbPath = "/home/test/.omp/agent/terminal-sessions/ttys000";
  const files = new Map([
    [breadcrumbPath, Buffer.from(`/workspace\n${rootPath}\n`, "utf8")],
    [rootPath, ompJournal("Root title", { type: "session", id: "root" })],
    [childPath, ompJournal("Child title", { type: "session", id: "untrusted-child-header" })],
    ["/home/test/.omp/agent/sessions/project/unrelated.jsonl", ompJournal("No", { type: "session", id: "unrelated" })],
  ]);
  const handle = (id) => ({ id });
  const terminal = {
    terminal: { id: "terminal" }, project: { id: "project" }, environment: { id: "environment" }, process: { id: "process" },
    foreground: { executableName: "omp" }, tty: { deviceId: "ttys000" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]), signal: { aborted: false, throwIfAborted() {} },
    async bindSession(request) { return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal }; },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "process" }, executableName: "omp" }]; },
        async openFiles() { return [childPath, "/home/test/.omp/agent/sessions/project/unrelated.jsonl"].map((path) => ({ handle: handle(path), path, access: "writable" })); },
        async environment() { return {}; },
      },
      files: {
        async resolveHomeRelative(relativePath) { const path = `/home/test/${relativePath}`; return files.has(path) ? handle(path) : undefined; },
        async resolvePathUnderHome(providerPath, options) { const prefix = `/home/test/${options.beneath.homeRelative}/`; return providerPath.startsWith(prefix) && files.has(providerPath) ? handle(providerPath) : undefined; },
        async homeRelativePath(file, options) { const prefix = `/home/test/${options.beneath.homeRelative}/`; return file.id.startsWith(prefix) ? file.id.slice(prefix.length) : undefined; },
        async canonicalFile(file) { return files.has(file.id) ? file : undefined; }, async realpath(file) { return file; },
        async stat(file) { return files.has(file.id) ? { handle: file, kind: "file", size: files.get(file.id).byteLength } : undefined; },
        async read(file, options) { return files.get(file.id).subarray(0, options.maxBytes); },
        async readJson() { return undefined; }, async readJsonLine() { return undefined; },
        async follow(file) { const bytes = files.get(file.id); return { async *[Symbol.asyncIterator]() { yield { type: "append", bytes }; }, dispose() {} }; },
      },
    },
  };
  const result = await ompAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  assert.equal(result.binding.providerSessionId, "root");
  assert.deepEqual(result.childSources.map((child) => child.childId), ["child-file-id"]);
});

function ompJournal(title, record) {
  const titleRecord = Buffer.from(JSON.stringify({ type: "title", title }), "utf8");
  const slot = Buffer.concat([titleRecord, Buffer.alloc(255 - titleRecord.length, 32), Buffer.from("\n")]);
  return Buffer.concat([slot, Buffer.from(`${JSON.stringify(record)}\n`, "utf8")]);
}

function ompObservationFixture(sessionId, title, options = {}) {
  const rootPath = `/home/test/.omp/agent/sessions/project/${sessionId}.jsonl`;
  const breadcrumbPath = "/home/test/.omp/agent/terminal-sessions/ttys000";
  const files = new Map([
    [breadcrumbPath, Buffer.from(options.breadcrumb ?? `/workspace\n${rootPath}\n`, "utf8")],
    [rootPath, ompJournal(title, { type: "session", id: sessionId })],
  ]);
  const handle = (id) => ({ id });
  let bindingRequest;
  const terminal = {
    terminal: { id: "terminal" }, project: { id: "project" }, environment: { id: "environment" }, process: { id: "process" }, foreground: { executableName: "omp" }, tty: { deviceId: "ttys000" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]), signal: { aborted: false, throwIfAborted() {} },
    async bindSession(request) { bindingRequest = request; return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal }; },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "process" }, executableName: "omp" }]; },
        async openFiles() { return options.writer === false ? [] : [{ handle: handle(rootPath), path: rootPath, access: "writable" }]; },
        async environment() { return {}; },
      },
      files: {
        async resolveHomeRelative(relativePath) { const path = `/home/test/${relativePath}`; return files.has(path) ? handle(path) : undefined; },
        async resolvePathUnderHome(providerPath, request) { const prefix = `/home/test/${request.beneath.homeRelative}/`; return providerPath.startsWith(prefix) && files.has(providerPath) ? handle(providerPath) : undefined; },
        async homeRelativePath(file, request) { const prefix = `/home/test/${request.beneath.homeRelative}/`; return file.id.startsWith(prefix) ? file.id.slice(prefix.length) : undefined; },
        async canonicalFile(file) { return files.has(file.id) ? file : undefined; }, async realpath(file) { return file; },
        async stat(file) { return files.has(file.id) ? { handle: file, kind: "file", size: files.get(file.id).byteLength } : undefined; },
        async read(file, request) { return (files.get(file.id) ?? Buffer.alloc(0)).subarray(0, request.maxBytes); },
        async readJson() { return undefined; }, async readJsonLine() { return undefined; },
        async follow(file) { const bytes = files.get(file.id); return { async *[Symbol.asyncIterator]() { if (bytes) yield { type: "append", bytes }; }, dispose() {} }; },
      },
    },
  };
  return { terminal, get bindingRequest() { return bindingRequest; } };
}
