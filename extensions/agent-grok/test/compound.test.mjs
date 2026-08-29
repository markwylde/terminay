import assert from "node:assert/strict";
import test from "node:test";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";
import extension, { createGrokRecordMapper, grokAgentProvider } from "../dist/index.js";

const firstId = "01a04dd9-f9f9-77c0-9ea0-8a8f627ea29c";
const secondId = "01a04da8-7fd7-77d2-99b4-60713a35290b";

function root(sessionId, turn = 0) {
  return [
    { ts: "2026-08-05T10:00:00.000Z", type: "mcp_config_resolved", servers: [], disabled: [] },
    {
      ts: "2026-08-05T10:00:01.000Z",
      type: "turn_started",
      session_id: sessionId,
      turn_number: turn,
      model_id: "grok-4.6",
      session_relationship: "primary",
    },
  ];
}

test("two terminal process trees bind independent Grok roots without cross-terminal leakage", async () => {
  const left = await createAgentExtensionHarness(extension);
  const right = await createAgentExtensionHarness(extension);
  try {
    await Promise.all([
      left.observe(fixtureTerminal({
        foregroundExecutable: "grok",
        files: { [`/home/test/.grok/sessions/%2Fleft/${firstId}/events.jsonl`]: root(firstId, 0) },
      })),
      right.observe(fixtureTerminal({
        foregroundExecutable: "grok",
        files: { [`/home/test/.grok/sessions/%2Fright/${secondId}/events.jsonl`]: root(secondId, 1) },
      })),
    ]);
    assert.deepEqual(left.events().map((event) => event.turnId).filter(Boolean), ["grok-turn-0"]);
    assert.deepEqual(right.events().map((event) => event.turnId).filter(Boolean), ["grok-turn-1"]);
  } finally {
    await Promise.all([left.dispose(), right.dispose()]);
  }
});

test("new, resumed and branched roots rebind only to the newest exact writable Grok root", async () => {
  const oldPath = `/home/test/.grok/sessions/%2Fworkspace/${firstId}/events.jsonl`;
  const resumedPath = `/home/test/.grok/sessions/%2Fworkspace/${secondId}/events.jsonl`;
  const files = {
    [oldPath]: root(firstId),
    [resumedPath]: root(secondId, 1),
  };
  const handles = new Map(Object.keys(files).map((path) => [path, { id: path }]));
  let bindingRequest;
  const terminal = {
    foreground: { executableName: "grok" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "grok" }, executableName: "grok" }]; },
        async openFiles() { return [...handles].map(([path, handle]) => ({ path, handle, access: "writable" })); },
        async environment() { return {}; },
      },
      files: {
        async canonicalFile(handle) { return handles.get(handle.id); },
        async homeRelativePath(handle, options) {
          const prefix = `/home/test/${options.beneath.homeRelative}/`;
          return handle.id.startsWith(prefix) ? handle.id.slice(prefix.length) : undefined;
        },
        async environmentRelativePath() { return undefined; },
        async resolveHomeRelative() { return undefined; },
        async resolveRelativeToEnvironment() { return undefined; },
        async read(handle) {
          return new TextEncoder().encode(`${files[handle.id].map(JSON.stringify).join("\n")}\n`);
        },
        async stat(handle) {
          return { handle, kind: "file", size: 1, modifiedAt: handle.id === resumedPath ? "2026-08-05T10:01:00.000Z" : "2026-08-05T10:00:00.000Z" };
        },
        async follow(handle) {
          const bytes = new TextEncoder().encode(`${files[handle.id].map(JSON.stringify).join("\n")}\n`);
          return { async *[Symbol.asyncIterator]() { yield { type: "append", bytes }; }, dispose() {} };
        },
      },
    },
    async bindSession(request) { bindingRequest = request; return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal }; },
  };
  const result = await grokAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  assert.equal(result.binding.providerSessionId, secondId);
  assert.equal(bindingRequest.journal.id, resumedPath);
  assert.equal(bindingRequest.fingerprint.file.id, resumedPath);
});

test("a non-primary Grok journal cannot become the root", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "grok",
      files: {
        [`/home/test/.grok/sessions/%2Fworkspace/${firstId}/events.jsonl`]: [
          { type: "turn_started", session_id: firstId, turn_number: 0, session_relationship: "subagent", model_id: "grok-4.6" },
        ],
      },
    }));
    assert.deepEqual(harness.events(), []);
  } finally {
    await harness.dispose();
  }
});

test("IPC number-array follow chunks still replay turn_ended", async () => {
  const path = `/home/test/.grok/sessions/%2Fworkspace/${firstId}/events.jsonl`;
  const records = [
    { type: "turn_started", session_id: firstId, turn_number: 0, session_relationship: "primary", model_id: "grok-4.6" },
    { type: "turn_ended", outcome: "completed" },
  ];
  const encoded = new TextEncoder().encode(`${records.map(JSON.stringify).join("\n")}\n`);
  const handle = { id: path };
  const terminal = {
    foreground: { executableName: "grok" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "grok" }, executableName: "grok" }]; },
        async openFiles() { return [{ path, handle, access: "writable" }]; },
        async environment() { return {}; },
      },
      files: {
        async canonicalFile(file) { return file === handle ? file : undefined; },
        async homeRelativePath() { return undefined; },
        async environmentRelativePath() { return undefined; },
        async resolveHomeRelative() { return undefined; },
        async resolveRelativeToEnvironment() { return undefined; },
        async read() { return encoded; },
        async stat() { return { handle, kind: "file", size: encoded.byteLength }; },
        async follow() {
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "append", bytes: [...encoded] };
            },
            dispose() {},
          };
        },
      },
    },
    async bindSession(request) {
      return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal };
    },
  };
  const result = await grokAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  const events = [];
  const publish = {
    publish: (event) => events.push(event),
    sessionStarted: (event) => events.push({ kind: "session.started", ...event }),
    metadataChanged: (event) => events.push({ kind: "agent.metadata", ...event }),
    turnStarted: (event) => events.push({ kind: "turn.started", ...event }),
    toolStarted: (event) => events.push({ kind: "tool.started", ...event }),
    toolFinished: (event) => events.push({ kind: "tool.finished", ...event }),
    waitStarted: (event) => events.push({ kind: "wait.started", ...event }),
    waitFinished: (event) => events.push({ kind: "wait.finished", ...event }),
    done: (event) => events.push({ kind: "agent.done", ...event }),
  };
  for await (const chunk of result.source) {
    const text = new TextDecoder().decode(chunk.bytes);
    for (const line of text.split("\n")) {
      if (line) result.mapRecord(JSON.parse(line), { binding: result.binding, journal: { role: "root" }, publish, signal: terminal.signal });
    }
  }
  assert.deepEqual(events.map((event) => event.kind), ["session.started", "turn.started", "agent.done"]);
});

test("chunked replay of a resumed journal still applies a later turn_ended as done", async () => {
  const path = `/home/test/.grok/sessions/%2Fworkspace/${firstId}/events.jsonl`;
  const records = [
    { type: "turn_started", session_id: firstId, turn_number: 0, session_relationship: "primary", model_id: "grok-4.6" },
    { type: "tool_started", tool_name: "read_file" },
    { type: "tool_completed", tool_name: "read_file", outcome: "success" },
    { type: "turn_ended", outcome: "completed" },
    { type: "mcp_config_resolved", servers: [], disabled: [] },
  ];
  const encoded = new TextEncoder().encode(`${records.map(JSON.stringify).join("\n")}\n`);
  const split = Math.max(20, Math.floor(encoded.byteLength / 2));
  const handle = { id: path };
  const terminal = {
    foreground: { executableName: "grok" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "grok" }, executableName: "grok" }]; },
        async openFiles() { return [{ path, handle, access: "writable" }]; },
        async environment() { return {}; },
      },
      files: {
        async canonicalFile(file) { return file === handle ? file : undefined; },
        async homeRelativePath() { return undefined; },
        async environmentRelativePath() { return undefined; },
        async resolveHomeRelative() { return undefined; },
        async resolveRelativeToEnvironment() { return undefined; },
        async read() { return encoded; },
        async stat() { return { handle, kind: "file", size: encoded.byteLength }; },
        async follow() {
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "append", bytes: encoded.slice(0, split) };
              yield { type: "append", bytes: encoded.slice(split) };
            },
            dispose() {},
          };
        },
      },
    },
    async bindSession(request) {
      return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal };
    },
  };
  const result = await grokAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  const events = [];
  const publish = {
    publish: (event) => events.push(event),
    sessionStarted: (event) => events.push({ kind: "session.started", ...event }),
    metadataChanged: (event) => events.push({ kind: "agent.metadata", ...event }),
    turnStarted: (event) => events.push({ kind: "turn.started", ...event }),
    toolStarted: (event) => events.push({ kind: "tool.started", ...event }),
    toolFinished: (event) => events.push({ kind: "tool.finished", ...event }),
    waitStarted: (event) => events.push({ kind: "wait.started", ...event }),
    waitFinished: (event) => events.push({ kind: "wait.finished", ...event }),
    done: (event) => events.push({ kind: "agent.done", ...event }),
  };
  const decoderPending = { text: "" };
  for await (const chunk of result.source) {
    const reset = chunk.type !== "append";
    if (reset) decoderPending.text = "";
    decoderPending.text += new TextDecoder().decode(chunk.bytes);
    const lines = decoderPending.text.split("\n");
    decoderPending.text = lines.pop() ?? "";
    for (const line of lines) {
      if (line) result.mapRecord(JSON.parse(line), { binding: result.binding, journal: { role: "root" }, publish, signal: terminal.signal });
    }
  }
  assert.equal(events.at(-1)?.kind, "agent.done");
  assert.equal(events.at(-1)?.outcome, "success");
  assert.equal(events.filter((event) => event.kind === "turn.started").length, 1);
});

test("binds a writer-held events journal when the shell cannot expose HOME", async () => {
  const path = `/Users/mark/.grok/sessions/%2Fworkspace/${firstId}/events.jsonl`;
  const handle = { id: path };
  let bindingRequest;
  const terminal = {
    foreground: { executableName: "grok" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "grok" }, executableName: "grok" }]; },
        async openFiles() { return [{ path, handle, access: "writable" }]; },
        async environment() { return {}; },
      },
      files: {
        async canonicalFile(file, options) {
          if (options?.beneath) return undefined;
          return file === handle ? file : undefined;
        },
        async homeRelativePath() { return undefined; },
        async environmentRelativePath() { return undefined; },
        async resolveHomeRelative() { return undefined; },
        async resolveRelativeToEnvironment() { return undefined; },
        async read() {
          return new TextEncoder().encode(`${JSON.stringify({ type: "turn_started", session_id: firstId, turn_number: 0, session_relationship: "primary" })}\n`);
        },
        async stat() { return { handle, kind: "file", size: 1, modifiedAt: "2026-08-05T10:00:00.000Z" }; },
        async follow() {
          return { async *[Symbol.asyncIterator]() {}, dispose() {} };
        },
      },
    },
    async bindSession(request) { bindingRequest = request; return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal }; },
  };
  const result = await grokAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  assert.equal(result.binding.providerSessionId, firstId);
  assert.equal(bindingRequest.fingerprint.kind, "writable-file-below-terminal-process");
});

test("binds from active_sessions.json when the writer does not hold events.jsonl", async () => {
  const cwd = "/workspace";
  const encoded = encodeURIComponent(cwd);
  const journalPath = `/home/test/.grok/sessions/${encoded}/${firstId}/events.jsonl`;
  const registryPath = "/home/test/.grok/active_sessions.json";
  const journal = { id: journalPath };
  const registry = { id: registryPath };
  const files = {
    [registryPath]: [{ session_id: firstId, pid: 4242, cwd, opened_at: "2026-08-05T10:00:00.000Z" }],
    [journalPath]: [
      { type: "turn_started", session_id: firstId, turn_number: 0, model_id: "grok-4.6", session_relationship: "primary" },
      { type: "turn_ended", outcome: "completed" },
    ],
  };
  let bindingRequest;
  const terminal = {
    foreground: { executableName: "grok" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "grok" }, executableName: "grok", pid: 4242, cwd }]; },
        async openFiles() { return []; },
        async environment() { return {}; },
      },
      files: {
        async canonicalFile() { return undefined; },
        async homeRelativePath() { return undefined; },
        async environmentRelativePath() { return undefined; },
        async resolveHomeRelative(relative) {
          if (relative === ".grok/active_sessions.json") return registry;
          if (relative === `.grok/sessions/${encoded}/${firstId}/events.jsonl`) return journal;
          return undefined;
        },
        async resolveRelativeToEnvironment() { return undefined; },
        async read(handle) {
          const value = files[handle.id];
          if (handle.id === registryPath) return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
          return new TextEncoder().encode(`${value.map((record) => JSON.stringify(record)).join("\n")}\n`);
        },
        async stat() { return { handle: journal, kind: "file", size: 1 }; },
        async follow() {
          const bytes = new TextEncoder().encode(`${files[journalPath].map(JSON.stringify).join("\n")}\n`);
          return { async *[Symbol.asyncIterator]() { yield { type: "append", bytes }; }, dispose() {} };
        },
      },
    },
    async bindSession(request) { bindingRequest = request; return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal }; },
  };
  const result = await grokAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  assert.equal(result.binding.providerSessionId, firstId);
  assert.equal(bindingRequest.fingerprint.kind, "grok-active-session-registry");
  assert.equal(bindingRequest.fingerprint.file.id, registryPath);
  assert.equal(bindingRequest.fingerprint.process.id, "grok");
});

test("GROK_HOME relocates the sessions root without reading the default home", async () => {
  const custom = `/data/grok/sessions/%2Fworkspace/${firstId}/events.jsonl`;
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "grok",
      environment: { GROK_HOME: "/data/grok" },
      files: { [custom]: root(firstId) },
    }));
    assert.equal(harness.events()[0]?.kind, "session.started");
    assert.equal(harness.events()[1]?.turnId, "grok-turn-0");
  } finally {
    await harness.dispose();
  }
});

test("a later summary.json rewrite updates the bound root title without stalling turn_ended", { timeout: 5_000 }, async () => {
  const eventsPath = `/home/test/.grok/sessions/%2Fworkspace/${firstId}/events.jsonl`;
  const summaryPath = `/home/test/.grok/sessions/%2Fworkspace/${firstId}/summary.json`;
  const records = [
    { type: "turn_started", session_id: firstId, turn_number: 0, session_relationship: "primary", model_id: "grok-4.6" },
    { type: "turn_ended", outcome: "completed" },
  ];
  const encodedEvents = new TextEncoder().encode(`${records.map(JSON.stringify).join("\n")}\n`);
  const firstSummary = new TextEncoder().encode(`${JSON.stringify({
    info: { id: firstId },
    generated_title: "Native Grok chat",
    current_model_id: "grok-4.6",
  })}\n`);
  const renamedSummary = new TextEncoder().encode(`${JSON.stringify({
    info: { id: firstId },
    generated_title: "Renamed Grok session",
    current_model_id: "grok-4.6",
  })}\n`);
  const eventsHandle = { id: eventsPath };
  const summaryHandle = { id: summaryPath };
  let summaryBytes = firstSummary;
  let hanging = false;
  const terminal = {
    foreground: { executableName: "grok" },
    capabilities: new Set(["process-observation", "filesystem-observation", "agent-journal"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {
      processes: {
        async descendants() { return [{ handle: { id: "grok" }, executableName: "grok" }]; },
        async openFiles() { return [{ path: eventsPath, handle: eventsHandle, access: "writable" }]; },
        async environment() { return {}; },
      },
      files: {
        async canonicalFile(file) { return file === eventsHandle ? file : undefined; },
        async homeRelativePath(handle) {
          return handle.id.startsWith("/home/test/.grok/sessions/")
            ? handle.id.slice("/home/test/.grok/sessions/".length)
            : undefined;
        },
        async environmentRelativePath() { return undefined; },
        async resolveHomeRelative(relative) {
          return relative.endsWith("summary.json") ? summaryHandle : undefined;
        },
        async resolveRelativeToEnvironment() { return undefined; },
        async read(handle) { return handle === summaryHandle ? summaryBytes : encodedEvents; },
        async stat(handle) {
          return { handle, kind: "file", size: handle === summaryHandle ? summaryBytes.byteLength : encodedEvents.byteLength };
        },
        async follow(handle) {
          if (handle === summaryHandle) {
            return {
              async *[Symbol.asyncIterator]() {
                yield { type: "append", bytes: firstSummary };
                summaryBytes = renamedSummary;
                yield { type: "replace", bytes: renamedSummary };
                hanging = true;
                await new Promise(() => {});
              },
              dispose() {},
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "append", bytes: encodedEvents };
            },
            dispose() {},
          };
        },
      },
    },
    async bindSession(request) {
      return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal };
    },
  };
  const result = await grokAgentProvider.observe(terminal);
  assert.equal(result.state, "bound");
  const events = [];
  const publish = {
    publish: (event) => events.push(event),
    sessionStarted: (event) => events.push({ kind: "session.started", ...event }),
    metadataChanged: (event) => events.push({ kind: "agent.metadata", ...event }),
    turnStarted: (event) => events.push({ kind: "turn.started", ...event }),
    toolStarted: (event) => events.push({ kind: "tool.started", ...event }),
    toolFinished: (event) => events.push({ kind: "tool.finished", ...event }),
    waitStarted: (event) => events.push({ kind: "wait.started", ...event }),
    waitFinished: (event) => events.push({ kind: "wait.finished", ...event }),
    done: (event) => events.push({ kind: "agent.done", ...event }),
  };
  const titles = [];
  for await (const chunk of result.source) {
    const text = new TextDecoder().decode(chunk.bytes instanceof Uint8Array ? chunk.bytes : Uint8Array.from(chunk.bytes ?? []));
    for (const line of text.split("\n")) {
      if (!line) continue;
      const record = JSON.parse(line);
      result.mapRecord(record, { binding: result.binding, journal: { role: "root" }, publish, signal: terminal.signal });
      if (record.type === "terminay.grok_metadata" && record.title) titles.push(record.title);
    }
    if (titles.includes("Renamed Grok session") && events.some((event) => event.kind === "agent.done")) break;
  }
  result.source.dispose();
  assert.deepEqual(titles, ["Native Grok chat", "Renamed Grok session"]);
  assert.equal(events.some((event) => event.kind === "agent.done"), true);
  assert.equal(events.find((event) => event.kind === "agent.done")?.outcome, "success");
  assert.equal(events.find((event) => event.kind === "agent.metadata" && event.title === "Renamed Grok session")?.title, "Renamed Grok session");
  assert.equal(hanging, true);
});

test("malformed, unknown and oversized records cannot create a wait or leak payloads", () => {
  const events = [];
  const publish = new Proxy({ publish: (event) => events.push(event) }, {
    get(target, name) {
      if (name in target) return target[name];
      return (event) => events.push({ kind: String(name), ...event });
    },
  });
  const context = { binding: { providerSessionId: firstId }, journal: { role: "root" }, publish };
  const map = createGrokRecordMapper();
  for (const record of [
    null,
    [],
    {},
    { type: "permission_requested", tool_name: "x".repeat(201), command: "PRIVATE" },
    { type: "turn_started", session_id: firstId, turn_number: 0, session_relationship: "primary" },
    { type: "unknown_future_event", output: "PRIVATE" },
    { type: "tool_started", tool_name: "read_file", arguments: { path: "/private" } },
    { type: "tool_completed", tool_name: "read_file", outcome: "success", output: "PRIVATE OUTPUT" },
  ]) map(record, context);
  assert.deepEqual(events.map((event) => event.kind), ["sessionStarted", "turnStarted", "toolStarted", "toolFinished"]);
  assert.equal(JSON.stringify(events).includes("PRIVATE"), false);
});
