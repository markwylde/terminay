import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import extension, { createGrokRecordMapper, effectiveGrokHome, grokAgentProvider, isGrokForeground } from "../dist/index.js";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";

const sessionId = "01a04dd9-f9f9-77c0-9ea0-8a8f627ea29c";
const journal = `/home/test/.grok/sessions/%2Fworkspace/${sessionId}/events.jsonl`;

async function records() {
  return (await readFile(new URL("../fixtures/v0.1/basic.jsonl", import.meta.url), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
}

test("registers a Grok provider and binds only an exact writable events journal", async () => {
  const input = await records();
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({ foregroundExecutable: "grok", files: { [journal]: input } }));
    assert.deepEqual(harness.events().map((event) => event.kind), [
      "session.started", "turn.started", "tool.started", "wait.started", "wait.finished", "tool.finished",
      "tool.started", "tool.finished", "agent.done",
    ]);
    assert.equal(harness.events()[0]?.title, "Grok");
    assert.deepEqual(harness.events()[0]?.model, { id: "grok-4.6" });
    assert.equal(harness.events()[1]?.turnId, "grok-turn-0");
    assert.equal(JSON.stringify(harness.events()).includes("private"), false);
    assert.equal(JSON.stringify(harness.events()).includes("call-private-1"), false);
  } finally {
    await harness.dispose();
  }
});

test("summary.json titles the bound root and survives a later native turn", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "grok",
      files: {
        [journal]: [
          { type: "mcp_config_resolved", servers: [], disabled: [] },
          { type: "turn_started", session_id: sessionId, turn_number: 0, model_id: "grok-4.6", session_relationship: "primary" },
          { type: "turn_ended", outcome: "completed" },
        ],
        [`/home/test/.grok/sessions/%2Fworkspace/${sessionId}/summary.json`]: [{
          info: { id: sessionId },
          generated_title: "Build Grok extension",
          current_model_id: "grok-4.6",
        }],
      },
    }));
    assert.equal(harness.events().some((event) => event.kind === "agent.metadata" && event.title === "Build Grok extension"), true);
    assert.equal(harness.events().some((event) => event.kind === "agent.done"), true);
  } finally {
    await harness.dispose();
  }
});

test("does not bind a Grok-looking record outside an events journal", async () => {
  const input = await records();
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "grok",
      files: { [`/tmp/not-a-session/${sessionId}/chat_history.jsonl`]: input },
    }));
    assert.deepEqual(harness.events(), []);
  } finally {
    await harness.dispose();
  }
});

test("maps titles, waits, MCP tools, completion and privacy allowlists", () => {
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
  const context = { binding: { providerSessionId: sessionId }, journal: { role: "root" }, publish };
  const map = createGrokRecordMapper();
  map({ type: "terminay.grok_metadata", sessionId, title: "Build Grok extension", modelId: "grok-4.6" }, context);
  map({ type: "turn_started", session_id: sessionId, turn_number: 0, model_id: "grok-4.6", session_relationship: "primary" }, context);
  map({ type: "terminay.grok_metadata", sessionId, title: "Renamed Grok session" }, context);
  map({ type: "assistant", content: "private assistant output" }, context);
  map({ type: "phase_changed", phase: "streaming_reasoning" }, context);
  assert.deepEqual(events.map((event) => event.kind), ["agent.metadata", "session.started", "turn.started", "agent.metadata"]);
  assert.equal(events[0]?.title, "Build Grok extension");
  assert.equal(events[1]?.title, "Build Grok extension");
  assert.equal(events[3]?.title, "Renamed Grok session");
  assert.equal(JSON.stringify(events).includes("private assistant"), false);
});

test("a completed turn followed by resume MCP records stays done, not working", () => {
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
  const context = { binding: { providerSessionId: sessionId }, journal: { role: "root" }, publish };
  const map = createGrokRecordMapper();
  map({ type: "turn_started", session_id: sessionId, turn_number: 2, session_relationship: "primary", model_id: "grok-4.6" }, context);
  map({ type: "tool_started", tool_name: "read_file" }, context);
  map({ type: "tool_completed", tool_name: "read_file", outcome: "success" }, context);
  map({ type: "turn_ended", outcome: "completed" }, context);
  map({ type: "mcp_config_resolved", servers: [], disabled: [] }, context);
  map({ type: "mcp_init_completed", succeeded: 1, failed: 0 }, context);
  assert.deepEqual(events.map((event) => event.kind), [
    "session.started", "turn.started", "tool.started", "tool.finished", "agent.done",
  ]);
  assert.equal(events.at(-1)?.outcome, "success");
});

test("recognizes Grok executables and honors GROK_HOME", () => {
  assert.equal(isGrokForeground("grok"), true);
  assert.equal(isGrokForeground("grok-macos-aarch64"), true);
  assert.equal(isGrokForeground("agent"), false);
  assert.equal(isGrokForeground("cursor-agent"), false);
  assert.equal(grokAgentProvider.matchesForeground({ executableName: "grok" }), true);
  assert.equal(grokAgentProvider.matchesForeground({ executableName: "bash" }), false);
  assert.match(effectiveGrokHome({ HOME: "/home/ignored", GROK_HOME: "/custom/grok" }), /\/custom\/grok$/u);
});
