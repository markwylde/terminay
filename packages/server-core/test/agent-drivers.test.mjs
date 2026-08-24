import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { codexV01Driver, createAgentDriverRegistry } from "../dist/activity/agentDrivers.js";

async function fixture(version) {
  const text = await readFile(new URL(`./fixtures/codex/${version}/basic.jsonl`, import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

async function ompFixture(name) {
  const text = await readFile(new URL(`./fixtures/omp/v0.1/${name}.jsonl`, import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

async function cursorFixture() {
  const text = await readFile(new URL("./fixtures/cursor/v0.1/basic.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

test("Cursor v0.1 transcript reduces turns without exposing assistant or tool content", async () => {
  const records = await cursorFixture();
  const registry = createAgentDriverRegistry();
  assert.equal(registry.resolve("cursor")?.mappingVersion, "0.1");
  const events = records.map((record, index) => registry.normalize("cursor", undefined, record, {
    activationTerminalSessionId: "terminal-1", providerSessionId: "cursor-session", providerDisplayName: "Cursor Session Title", providerModelId: "grok-4.6", sequence: index + 1, occurredAt: index + 1,
  })).filter(Boolean).flat();
  assert.deepEqual(events.map(({ kind }) => kind), ["session.started", "turn.started", "turn.started", "agent.done"]);
  assert.equal(events[1]?.promptText, "Inspect Cursor support");
  assert.equal(events[0]?.displayName, "Cursor Session Title");
  assert.deepEqual(events[0]?.model, { id: "grok-4.6", displayName: "Grok 4.6" });
  assert.equal(events[3]?.outcome, "success");
  assert.equal(JSON.stringify(events).includes("Private response"), false);
  assert.equal(JSON.stringify(events).includes("private"), false);
});

test("Codex v0.1 rollout records normalize through the v0.1 mapping", async () => {
  const registry = createAgentDriverRegistry();
  const records = await fixture("v0.1");
  const inspected = registry.inspectSession("codex", records[0]);
  assert.equal(inspected?.session.providerSessionId, "fixture-session-v01");
  const resolved = registry.resolve("codex", inspected?.session.providerVersion);
  assert.equal(resolved?.mappingVersion, "0.1");
  const events = records.map((record, index) => registry.normalize("codex", inspected?.session.providerVersion, record, {
    activationTerminalSessionId: "terminal-1", providerSessionId: inspected?.session.providerSessionId,
    sequence: index + 1, occurredAt: index + 1,
  })).filter(Boolean);
  assert.deepEqual(events.map(({ kind }) => kind), ["session.started", "turn.started", "tool.started", "tool.finished", "wait.started", "agent.done"]);
});

test("newer and older Codex releases resolve permissively to the closest mapping", () => {
  const registry = createAgentDriverRegistry();
  assert.equal(registry.resolve("codex", "0.2.0")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("codex", "0.146.0")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("codex", "0.0.5")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("claude-code", "1.0.0")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("omp")?.mappingVersion, "0.1");
});

test("OMP v0.1 ignores the title slot and reduces only allowlisted lifecycle records", async () => {
  const registry = createAgentDriverRegistry();
  const records = await ompFixture("basic");
  assert.equal(registry.inspectSession("omp", records[0]), null);
  const inspected = registry.inspectSession("omp", records[1]);
  assert.deepEqual(inspected?.session, { providerSessionId: "omp-root-v01" });
  const events = records.map((record, index) => registry.normalize("omp", undefined, record, {
    activationTerminalSessionId: "terminal-1", providerSessionId: inspected?.session.providerSessionId,
    sequence: index + 1, occurredAt: index + 1,
  })).filter(Boolean);
  assert.deepEqual(events.map(({ kind }) => kind), ["session.started", "turn.started", "tool.started", "tool.finished", "agent.done", "session.stopped"]);
  assert.deepEqual(events[2]?.tool, { id: "call-1", name: "read" });
  assert.equal(events[3]?.toolId, "call-1");
  assert.equal(events[4]?.outcome, "success");
  assert.equal(events[5]?.reason, "session_exit");
  assert.equal(JSON.stringify(events).includes("private"), false);
});

test("OMP model changes update bounded metadata without changing lifecycle state", () => {
  const event = createAgentDriverRegistry().normalize("omp", undefined, {
    type: "model_change", model: "openai-codex/gpt-5.6-terra",
  }, { activationTerminalSessionId: "terminal-1", providerSessionId: "omp-root-v01", sequence: 1, occurredAt: 1 });
  assert.deepEqual(event, {
    provider: "omp", sessionId: "omp-root-v01", activationTerminalSessionId: "terminal-1", sequence: 1, occurredAt: 1,
    model: { id: "openai-codex/gpt-5.6-terra" }, kind: "agent.metadata",
  });
});

test("OMP child journals target their filename-derived subagent without rebinding the root", async () => {
  const registry = createAgentDriverRegistry();
  const records = await ompFixture("child");
  const events = records.map((record, index) => registry.normalize("omp", undefined, record, {
    activationTerminalSessionId: "terminal-1", providerSessionId: "omp-root-v01",
    journalRole: "child", childAgentId: "omp-child-v01", sequence: index + 1, occurredAt: index + 1,
  })).filter(Boolean);
  assert.deepEqual(events.map(({ kind }) => kind), ["subagent.started", "turn.started", "subagent.stopped"]);
  assert.deepEqual(events[0], {
    provider: "omp", sessionId: "omp-root-v01", activationTerminalSessionId: "terminal-1",
    sequence: 2, occurredAt: 1_785_924_000_000, kind: "subagent.started", subagentId: "omp-child-v01", parentAgentId: "omp-root-v01",
  });
  assert.equal(events[1]?.agentId, "omp-child-v01");
  assert.equal(events[1]?.promptText, "Inspect the parser");
  assert.equal(events[2]?.outcome, "cancelled");
});

test("OMP title slots and unknown records never establish a session", async () => {
  const registry = createAgentDriverRegistry();
  const [title] = await ompFixture("title-slot-only");
  assert.equal(registry.inspectSession("omp", title), null);
  assert.equal(registry.normalize("omp", undefined, title, {
    activationTerminalSessionId: "terminal-1", providerSessionId: "omp-root-v01", sequence: 1, occurredAt: 1,
  }), null);
  assert.equal(registry.normalize("omp", undefined, { type: "custom", customType: "unknown", data: { secret: "nope" } }, {
    activationTerminalSessionId: "terminal-1", providerSessionId: "omp-root-v01", sequence: 2, occurredAt: 2,
  }), null);
});

test("OMP assistant tool calls start matching tools without exposing arguments", () => {
  const event = createAgentDriverRegistry().normalize("omp", undefined, {
    type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "private" } }] },
  }, { activationTerminalSessionId: "terminal-1", providerSessionId: "omp-root-v01", sequence: 1, occurredAt: 1 });
  assert.deepEqual(event, {
    provider: "omp", sessionId: "omp-root-v01", activationTerminalSessionId: "terminal-1", sequence: 1, occurredAt: 1,
    kind: "tool.started", tool: { id: "call-2", name: "bash" },
  });
  assert.equal(JSON.stringify(event).includes("private"), false);
});

test("the greatest compatible provider/version mapping wins", () => {
  const codexV02Driver = { ...codexV01Driver, mappingVersion: "0.2" };
  const registry = createAgentDriverRegistry([codexV01Driver, codexV02Driver]);
  assert.equal(registry.resolve("codex", "0.1.9")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("codex", "0.2.0")?.mappingVersion, "0.2");
  assert.equal(registry.resolve("codex", "0.5.0")?.mappingVersion, "0.2");
  assert.equal(registry.resolve("codex", "0.0.1")?.mappingVersion, "0.1");
});

test("driver ignores content-bearing rollout records", () => {
  const registry = createAgentDriverRegistry();
  const event = registry.normalize("codex", "0.1.0", {
    type: "response_item", payload: { type: "message", content: "secret user content" },
  }, { activationTerminalSessionId: "terminal-1", providerSessionId: "session-1", sequence: 1, occurredAt: 1 });
  assert.equal(event, null);
});

test("driver uses Codex's completed UserMessage event as the session label", () => {
  const registry = createAgentDriverRegistry();
  const context = { activationTerminalSessionId: "terminal-1", providerSessionId: "session-1", sequence: 1, occurredAt: 1 };
  const event = registry.normalize("codex", "0.149.0", {
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "UserMessage",
        content: [
          { type: "image", image_url: "private-image" },
          { type: "text", text: "hi" },
        ],
      },
    },
  }, context);
  assert.equal(event?.kind, "turn.started");
  assert.equal(event?.promptText, "hi");

  assert.equal(registry.normalize("codex", "0.149.0", {
    type: "response_item",
    payload: {
      type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions\nInjected context" }],
    },
  }, context), null);
  assert.equal(registry.normalize("codex", "0.149.0", {
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "<turn_aborted>\nThe user interrupted the previous turn on purpose.\n</turn_aborted>",
    },
  }, context), null);
});

test("driver maps current Codex collaboration records to subagent lifecycle", () => {
  const registry = createAgentDriverRegistry();
  const normalize = (payload, sequence) => registry.normalize("codex", "0.149.0", {
    type: "event_msg", payload,
  }, { activationTerminalSessionId: "terminal-1", providerSessionId: "root-thread", sequence, occurredAt: sequence });

  assert.deepEqual(normalize({
    type: "collab_agent_spawn_end",
    sender_thread_id: "root-thread",
    new_thread_id: "child-thread",
    new_agent_nickname: "Ada",
    new_agent_role: "explorer",
    prompt: "Inspect the parser",
    model: "gpt-5.6-luna",
    reasoning_effort: "high",
    status: "running",
  }, 1), {
    provider: "codex", sessionId: "root-thread", activationTerminalSessionId: "terminal-1",
    sequence: 1, occurredAt: 1, model: { id: "gpt-5.6-luna", reasoningEffort: "high" },
    kind: "subagent.started", subagentId: "child-thread", parentAgentId: "root-thread",
    displayName: "Ada", promptText: "Inspect the parser",
  });
  assert.equal(normalize({
    type: "sub_agent_activity", agent_thread_id: "child-thread", agent_path: "/root/ada", kind: "interacted",
  }, 2)?.kind, "subagent.started");
  assert.deepEqual(normalize({
    type: "collab_agent_interaction_end", receiver_thread_id: "child-thread", status: { completed: "private result" },
  }, 3), {
    provider: "codex", sessionId: "root-thread", activationTerminalSessionId: "terminal-1",
    sequence: 3, occurredAt: 3, kind: "agent.done", agentId: "child-thread", outcome: "success",
  });
  assert.deepEqual(normalize({
    type: "collab_close_end", receiver_thread_id: "child-thread", status: "shutdown",
  }, 4), {
    provider: "codex", sessionId: "root-thread", activationTerminalSessionId: "terminal-1",
    sequence: 4, occurredAt: 4, kind: "subagent.stopped", subagentId: "child-thread", outcome: "success",
  });
});

test("driver fans out current completed CollabAgentToolCall items", () => {
  const registry = createAgentDriverRegistry();
  const context = { activationTerminalSessionId: "terminal-1", providerSessionId: "root-thread", sequence: 10, occurredAt: 10 };
  const spawn = registry.normalize("codex", "0.149.0", { type: "event_msg", payload: {
    type: "item_completed", item: {
      type: "CollabAgentToolCall", tool: "spawn_agent", sender_thread_id: "root-thread",
      receiver_thread_ids: ["child-a", "child-b"],
      receiver_agents: [
        { thread_id: "child-a", agent_nickname: "Gauss" },
        { thread_id: "child-b", agent_nickname: "Popper" },
      ],
      prompt: "Solve independently", model: "gpt-5.6-luna", reasoning_effort: "medium",
    },
  } }, context);
  assert.deepEqual(spawn?.map(({ kind, subagentId, displayName, parentAgentId }) => ({ kind, subagentId, displayName, parentAgentId })), [
    { kind: "subagent.started", subagentId: "child-a", displayName: "Gauss", parentAgentId: "root-thread" },
    { kind: "subagent.started", subagentId: "child-b", displayName: "Popper", parentAgentId: "root-thread" },
  ]);

  const completed = registry.normalize("codex", "0.149.0", { type: "event_msg", payload: {
    type: "item_completed", item: {
      type: "CollabAgentToolCall", tool: "wait",
      agents_states: { "child-a": { completed: "private result" }, "child-b": "interrupted" },
    },
  } }, context);
  assert.deepEqual(completed?.map(({ kind, agentId, outcome }) => ({ kind, agentId, outcome })), [
    { kind: "agent.done", agentId: "child-a", outcome: "success" },
    { kind: "agent.done", agentId: "child-b", outcome: "cancelled" },
  ]);
});

test("Claude driver reads explicit titles and Agent tool lifecycle without message injection", () => {
  const registry = createAgentDriverRegistry();
  const context = { activationTerminalSessionId: "terminal-1", providerSessionId: "claude-root", sequence: 1, occurredAt: 1 };
  assert.equal(registry.inspectSession("claude-code", {
    type: "permission-mode", mode: "default", sessionId: "claude-root", version: "2.1.201",
  })?.session.providerSessionId, "claude-root");
  assert.equal(registry.normalize("claude-code", "2.1.201", {
    type: "ai-title", aiTitle: "Add white background to text", sessionId: "claude-root",
  }, context)?.promptText, "Add white background to text");
  assert.equal(registry.normalize("claude-code", "2.1.201", {
    type: "user", sessionId: "claude-root", isMeta: true,
    message: { role: "user", content: "<local-command-caveat>injected metadata</local-command-caveat>" },
  }, context), null);

  const started = registry.normalize("claude-code", "2.1.201", {
    type: "assistant", sessionId: "claude-root", message: { role: "assistant", model: "claude-opus-4-8", content: [{
      type: "tool_use", id: "toolu-agent-1", name: "Agent",
      input: { description: "Research parser", prompt: "Inspect the journal", subagent_type: "general-purpose" },
    }] },
  }, context);
  assert.deepEqual(started, [{
    provider: "claude-code", sessionId: "claude-root", activationTerminalSessionId: "terminal-1",
    sequence: 1, occurredAt: 1, model: { id: "claude-opus-4-8" }, kind: "turn.started",
  }, {
    provider: "claude-code", sessionId: "claude-root", activationTerminalSessionId: "terminal-1",
    sequence: 1, occurredAt: 1, model: { id: "claude-opus-4-8" }, kind: "subagent.started",
    subagentId: "toolu-agent-1", parentAgentId: "claude-root", displayName: "Research parser", promptText: "Inspect the journal",
  }]);
});
