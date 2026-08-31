import assert from "node:assert/strict";
import test from "node:test";
import { createJsonlRecordDecoder } from "@terminay/extension-api";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";
import extension, { codexAgentProvider, mapCodexRecord } from "../dist/index.js";

const root = (id, model = "gpt-5.6-codex") => ({
  type: "session_meta", payload: { id, originator: "codex-tui", source: "cli", model },
});

function publisher(events) {
  return new Proxy({ publish: (event) => events.push(event) }, {
    get(target, name) {
      if (name in target) return target[name];
      const kinds = { sessionStarted: "session.started", metadataChanged: "agent.metadata", turnStarted: "turn.started", toolStarted: "tool.started", toolFinished: "tool.finished", waitStarted: "wait.started", waitFinished: "wait.finished", done: "agent.done", exited: "agent.exited", subagentStarted: "subagent.started", subagentDone: "subagent.done" };
      return (event) => events.push({ kind: kinds[name], ...event });
    },
  });
}

function terminalFor(files) {
  const handles = new Map(Object.keys(files).map((path) => [path, { id: path }]));
  let bindingRequest;
  return {
    terminal: { id: "terminal" }, project: { id: "project" }, environment: { id: "environment" }, process: { id: "process" },
    foreground: { executableName: "codex" }, capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "codex" }, executableName: "codex" }]; },
        async openFiles() { return [...handles].map(([path, handle]) => ({ path, handle, access: "writable" })); },
        async environment() { return {}; },
      },
      files: {
        async canonicalFile(handle) { return handles.get(handle.id); },
        async resolveHomeDirectory(relativePath) {
          const root = `/home/test/${relativePath}`;
          return [...handles.keys()].some((path) => path.startsWith(`${root}/`)) ? { id: root } : undefined;
        },
        async resolveDirectoryRelativeToEnvironment() { return undefined; },
        async listDirectory(directory, options) {
          const prefix = `${directory.id}/`;
          const entries = [];
          let bytes = 0;
          for (const [path, handle] of [...handles].sort(([left], [right]) => left.localeCompare(right))) {
            const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
            const record = files[path];
            const size = new TextEncoder().encode(record.records.map(JSON.stringify).join("\n")).byteLength;
            if (!relativePath || relativePath.split("/").length - 1 > options.maxDepth || !options.extensions.some((extension) => relativePath.endsWith(extension))) continue;
            if (entries.length >= options.maxEntries || bytes + size > options.maxBytes) break;
            bytes += size;
            entries.push({ handle, relativePath, size, modifiedAt: record.modifiedAt });
          }
          return { entries, truncated: false };
        },
        async resolveHomeRelative(relativePath) {
          const path = `/home/test/${relativePath}`;
          return handles.get(path);
        },
        async readJsonLine(handle) { return files[handle.id].records[0]; },
        async stat(handle) { return { handle, kind: "file", size: 1, modifiedAt: files[handle.id].modifiedAt }; },
        async follow(handle) {
          const configured = files[handle.id].chunks;
          const chunks = configured ?? [{ type: "append", bytes: new TextEncoder().encode(`${files[handle.id].records.map(JSON.stringify).join("\n")}\n`) }];
          return { async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; }, dispose() {} };
        },
      },
    },
    async bindSession(request) { bindingRequest = request; return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal }; },
    get bindingRequest() { return bindingRequest; },
  };
}

test("new, resumed and branched roots rebind only to the newest exact writable Codex root", async () => {
  const oldPath = "/home/test/.codex/sessions/2026/rollout-old.jsonl";
  const resumedPath = "/home/test/.codex/sessions/2026/rollout-resumed.jsonl";
  const terminal = terminalFor({
    [oldPath]: { modifiedAt: "2026-08-24T10:00:00.000Z", records: [root("old-root")] },
    [resumedPath]: { modifiedAt: "2026-08-24T10:01:00.000Z", records: [root("resumed-root")] },
  });
  const result = await codexAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  assert.equal(result.binding.providerSessionId, "resumed-root");
  assert.equal(terminal.bindingRequest.journal.id, resumedPath);
  assert.equal(terminal.bindingRequest.fingerprint.file.id, resumedPath);
});

test("a proven Codex rollout still binds when declared environment observation is refused", async () => {
  const path = "/home/test/.codex/sessions/2026/rollout-root.jsonl";
  const terminal = terminalFor({
    [path]: { modifiedAt: "2026-08-24T10:01:00.000Z", records: [root("root")] },
  });
  terminal.observation.processes.environment = async () => {
    throw new Error("agent environment observation is not declared");
  };
  const result = await codexAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  assert.equal(result.binding.providerSessionId, "root");
});

test("separate Codex child rollouts attach only through their native parent_thread_id", async () => {
  const rootPath = "/home/test/.codex/sessions/2026/08/rollout-root.jsonl";
  const childPath = "/home/test/.codex/sessions/2026/08/rollout-child.jsonl";
  const unrelatedPath = "/home/test/.codex/sessions/2026/08/rollout-unrelated-child.jsonl";
  const child = (id, parent, nickname) => ({
    type: "session_meta",
    payload: {
      id,
      source: { subagent: { thread_spawn: { parent_thread_id: parent, agent_nickname: nickname, agent_role: "research" } } },
      parent_thread_id: parent,
      agent_nickname: nickname,
      agent_path: `/agents/${nickname}`,
      model_provider: "gpt-5.6-terra",
    },
  });
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "codex",
      files: {
        [rootPath]: [root("root")],
        [childPath]: [child("child", "root", "Scout"), { type: "event_msg", payload: { type: "task_started", turn_id: "child-turn" } }, { type: "event_msg", payload: { type: "task_complete" } }],
        [unrelatedPath]: [child("other-child", "other-root", "Unrelated"), { type: "event_msg", payload: { type: "task_started", turn_id: "other-turn" } }],
      },
    }));
    assert.deepEqual(harness.events().map((event) => event.kind), ["session.started", "subagent.started", "turn.started", "agent.done"]);
    assert.deepEqual(harness.events()[1], { kind: "subagent.started", subagentId: "child", title: "Scout", model: { id: "gpt-5.6-terra" } });
    assert.deepEqual(harness.events()[2], { kind: "turn.started", agentId: "child", turnId: "child-turn" });
    assert.deepEqual(harness.events()[3], { kind: "agent.done", agentId: "child", outcome: "success" });
    assert.equal(JSON.stringify(harness.events()).includes("Unrelated"), false);
  } finally {
    await harness.dispose();
  }
});

test("a late Codex child rollout is attached through public directory discovery without rebinding its root", async () => {
  const rootPath = "/home/test/.codex/sessions/2026/08/rollout-root.jsonl";
  const childPath = "/home/test/.codex/sessions/2026/08/rollout-late-child.jsonl";
  const unrelatedPath = "/home/test/.codex/sessions/2026/08/rollout-unrelated.jsonl";
  const child = (id, parent, nickname) => ({
    type: "session_meta",
    payload: {
      id,
      source: { subagent: { thread_spawn: { parent_thread_id: parent, agent_nickname: nickname } } },
      agent_nickname: nickname,
      model_provider: "gpt-5.6-terra",
    },
  });
  const terminal = terminalFor({
    [rootPath]: { modifiedAt: "2026-08-24T10:01:00.000Z", records: [root("root")] },
    [childPath]: { modifiedAt: "2026-08-24T10:02:00.000Z", records: [child("late-child", "root", "Late Scout"), { type: "event_msg", payload: { type: "task_started", turn_id: "late-turn" } }] },
    [unrelatedPath]: { modifiedAt: "2026-08-24T10:03:00.000Z", records: [child("unrelated", "wrong-root", "Unrelated")] },
  });
  const directory = { id: "/home/test/.codex/sessions" };
  const list = terminal.observation.files.listDirectory.bind(terminal.observation.files);
  const all = await list(directory, { extensions: [".jsonl"], maxDepth: 4, maxEntries: 256, maxBytes: 16 * 1024 * 1024 });
  const initial = { entries: all.entries.filter((entry) => entry.handle.id === rootPath), truncated: false };
  terminal.observation.files.listDirectory = async () => initial;
  terminal.observation.files.watchDirectory = async () => ({
    async *[Symbol.asyncIterator]() { yield initial; yield all; },
    dispose() {},
  });

  const result = await codexAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  assert.deepEqual(result.childSources ?? [], []);
  assert.ok(result.childSourceDiscovery);
  const discovered = [];
  for await (const source of result.childSourceDiscovery) discovered.push(source);
  assert.deepEqual(discovered.map((source) => source.childId), ["late-child"]);

  const events = [];
  const context = { binding: result.binding, journal: { role: "child", childId: "late-child" }, publish: publisher(events) };
  const decoder = createJsonlRecordDecoder();
  const watcher = await discovered[0].source;
  for await (const chunk of watcher) {
    for (const record of decoder.push(chunk.bytes, chunk.type !== "append")) mapCodexRecord(record, context);
  }
  assert.deepEqual(events, [
    { kind: "subagent.started", subagentId: "late-child", title: "Late Scout", model: { id: "gpt-5.6-terra" } },
    { kind: "turn.started", agentId: "late-child", turnId: "late-turn" },
  ]);
  assert.equal(terminal.bindingRequest.providerSessionId, "root");
});

test("an exact Codex session-index title follows initial, repeated, replacement and resumed updates without replaying lifecycle", async () => {
  const journal = "/home/test/.codex/sessions/2026/rollout-resumed.jsonl";
  const index = "/home/test/.codex/session_index.jsonl";
  const chunk = (type, entries) => ({ type, bytes: new TextEncoder().encode(`${entries.map(JSON.stringify).join("\n")}\n`) });
  const terminal = terminalFor({
    [journal]: {
      modifiedAt: "2026-08-24T10:01:00.000Z",
      records: [root("resumed-root"), { type: "event_msg", payload: { type: "task_started", turn_id: "turn" } }, { type: "event_msg", payload: { type: "task_complete" } }],
    },
    [index]: {
      modifiedAt: "2026-08-24T10:01:00.000Z",
      records: [],
      chunks: [
        chunk("append", [{ id: "other-terminal", thread_name: "Other terminal" }, { id: "resumed-root", thread_name: "Initial title" }]),
        chunk("append", [{ id: "resumed-root", thread_name: "Renamed once" }, { id: "resumed-root", thread_name: "Renamed twice" }]),
        chunk("replace", [{ id: "resumed-root", thread_name: "Recovered after replacement" }]),
        chunk("truncate", [{ id: "resumed-root", thread_name: "Recovered after truncation" }]),
      ],
    },
  });
  const result = await codexAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  const records = [];
  for await (const watcherChunk of result.source) {
    for (const line of new TextDecoder().decode(watcherChunk.bytes).split("\n")) if (line) records.push(JSON.parse(line));
  }
  const events = [];
  const context = { binding: result.binding, publish: publisher(events) };
  const state = { promptPublished: false };
  for (const record of records) mapCodexRecord(record, context, state);
  assert.deepEqual(events.map((event) => event.kind), [
    "session.started", "turn.started", "agent.done",
    "agent.metadata", "agent.metadata", "agent.metadata", "agent.metadata", "agent.metadata",
  ]);
  assert.deepEqual(events.slice(3).map((event) => event.title), [
    "Initial title", "Renamed once", "Renamed twice", "Recovered after replacement", "Recovered after truncation",
  ]);
  assert.equal(events.some((event) => event.title === "Other terminal"), false);
  assert.equal(events.filter((event) => event.kind === "session.started").length, 1);
  assert.equal(events.filter((event) => event.kind === "turn.started").length, 1);
  assert.equal(events.filter((event) => event.kind === "agent.done").length, 1);
});

test("mapping variants, malformed and oversized native records fail closed", () => {
  const events = [];
  const context = { binding: { providerSessionId: "root" }, publish: publisher(events) };
  mapCodexRecord(root("root", "gpt-5.6-codex"), context);
  mapCodexRecord({ type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } }, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "turn_complete", status: "success" } }, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "shutdown_complete" } }, context);
  for (const record of [null, [], {}, { type: "event_msg", payload: { type: "user_message", message: "x".repeat(4_001) } }, { type: "event_msg", payload: { type: "error", output: "private" } }]) mapCodexRecord(record, context);
  assert.deepEqual(events.slice(0, 4).map((event) => event.kind), ["session.started", "turn.started", "agent.done", "session.stopped"]);
  assert.equal(JSON.stringify(events).includes("private"), false);
  assert.equal(JSON.stringify(events).includes("xxxx"), false);
});

test("collaboration lifecycle exposes bounded identity but never results, reasoning or tool payloads", () => {
  const events = [];
  const context = { binding: { providerSessionId: "root" }, publish: publisher(events) };
  mapCodexRecord({ type: "event_msg", payload: { type: "collab_agent_spawn_end", new_thread_id: "child", new_agent_nickname: "Research", prompt: "bounded task", model: "gpt-5.6-terra", reasoning_effort: "high", result: "PRIVATE RESULT", reasoning: "PRIVATE REASONING", tool_output: "PRIVATE TOOL" } }, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "collab_agent_interaction_end", receiver_thread_id: "child", status: { completed: "PRIVATE RESULT" } } }, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "collab_close_end", receiver_thread_id: "child" } }, context);
  assert.deepEqual(events.map((event) => event.kind), ["subagent.started", "subagent.done", "subagent.done"]);
  assert.deepEqual(events[0].model, { id: "gpt-5.6-terra", reasoningEffort: "high" });
  assert.equal(JSON.stringify(events).includes("PRIVATE"), false);
});

test("every supported approval and elicitation variant publishes one bounded wait and closes on progress", () => {
  const cases = [
    ["exec_approval_request", "exec-request", "request_id"],
    ["apply_patch_approval_request", "patch-call", "call_id"],
    ["request_permissions", "permission-id", "id"],
    ["request_user_input", "input-request", "request_id"],
    ["elicitation_request", "elicitation-call", "call_id"],
  ];
  for (const [eventType, waitId, idField] of cases) {
    const events = [];
    const state = { promptPublished: false };
    const context = { binding: { providerSessionId: "root" }, publish: publisher(events) };
    mapCodexRecord({
      type: "event_msg",
      payload: {
        type: eventType,
        [idField]: waitId,
        command: "PRIVATE COMMAND",
        cwd: "/private/path",
        patch: "PRIVATE PATCH",
        permissions: ["PRIVATE PERMISSION"],
        questions: [{ question: "PRIVATE QUESTION", options: ["PRIVATE OPTION"] }],
        message: "PRIVATE ELICITATION",
      },
    }, context, state);
    mapCodexRecord({ type: "event_msg", payload: { type: "task_started", turn_id: `turn-${waitId}` } }, context, state);
    assert.deepEqual(events, [
      { kind: "wait.started", waitId, state: "waiting", reason: eventType },
      { kind: "wait.finished", waitId },
      { kind: "turn.started", turnId: `turn-${waitId}` },
    ]);
    assert.equal(JSON.stringify(events).includes("PRIVATE"), false);
    assert.equal(JSON.stringify(events).includes("/private"), false);
  }
});

test("malformed, unknown and oversized approval-like records cannot create a wait or leak payloads", () => {
  const events = [];
  const context = { binding: { providerSessionId: "root" }, publish: publisher(events) };
  for (const record of [
    null,
    { type: "event_msg", payload: null },
    { type: "event_msg", payload: { type: "approval_request", id: "unsupported", command: "PRIVATE" } },
    { type: "event_msg", payload: { type: "exec_approval_request".repeat(20), request_id: "oversized-type", command: "PRIVATE" } },
    { type: "event_msg", payload: { type: "request_user_input", request_id: "x".repeat(513), questions: "PRIVATE" } },
  ]) mapCodexRecord(record, context);
  // A supported record with malformed identity uses a bounded provider/type
  // fallback; no provider-private request body crosses the boundary.
  assert.deepEqual(events, [{ kind: "wait.started", waitId: "codex:request_user_input", state: "waiting", reason: "request_user_input" }]);
  assert.equal(JSON.stringify(events).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(events).includes("oversized-type"), false);
});

test("the bounded decoder rejects an oversized physical record before mapping", () => {
  const decoder = createJsonlRecordDecoder(64);
  const records = decoder.push(new TextEncoder().encode(`${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "secret".repeat(100) } })}\n`));
  assert.deepEqual(records, []);
});
