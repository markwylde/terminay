import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, TerminalActivityService } from "../dist/index.js";
import { providerFromForegroundProcess } from "../dist/activity/agentService.js";

function fakeJournalSource() {
  let listener;
  const calls = [];
  return {
    calls,
    async start(value) { listener = value; calls.push(["start"]); },
    async stop() { calls.push(["stop"]); },
    registerTerminal(identity) { calls.push(["register", identity]); },
    terminalStarted(identity, pid) { calls.push(["started", identity, pid]); },
    foregroundProcessChanged(identity, provider, shell) { calls.push(["foreground", identity, provider, shell]); },
    unregisterTerminal(identity) { calls.push(["unregister", identity]); },
    setEnabled(enabled) { calls.push(["enabled", enabled]); },
    emit(observation) { return listener(observation); },
  };
}

const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });

test("omp foreground detection keeps a Bun wrapper armed without creating an unbound agent", () => {
  assert.equal(providerFromForegroundProcess("omp"), "omp");
  assert.equal(providerFromForegroundProcess("oh-my-pi"), "omp");
  assert.equal(providerFromForegroundProcess("/opt/homebrew/bin/bun"), "omp");
});

test("Cursor Agent CLI foreground executables select the Cursor journal source", () => {
  assert.equal(providerFromForegroundProcess("agent"), "cursor");
  assert.equal(providerFromForegroundProcess("/usr/local/bin/cursor-agent"), "cursor");
});

test("journal records reduce to canonical agent and activity state", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const source = fakeJournalSource();
  const agents = new AgentStatusService({ activity, journalSource: source, now: () => 100 });
  await agents.start();
  agents.register(identity);
  agents.terminalStarted(identity, 4321);
  agents.foregroundProcessChanged(identity, "codex", false);
  await source.emit({ identity, provider: "codex", record: { type: "session_meta", payload: { id: "codex-session", cli_version: "0.2.0" } } });
  await source.emit({ identity, provider: "codex", record: { type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } } });
  const entry = Object.values(agents.getSnapshot().entries)[0];
  assert.equal(entry.provider, "codex");
  assert.equal(entry.sessionId, "codex-session");
  assert.equal(entry.state, "working");
  assert.equal(activity.snapshot().sessions[identity.sessionId].source, "journal:codex");
  assert(source.calls.some(([kind, , pid]) => kind === "started" && pid === 4321));
  await agents.stop();
});

test("a process-bound Cursor transcript identity establishes and completes a root session", async () => {
  const activity = new TerminalActivityService({ serverId: "server-1" });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, journalSource: fakeJournalSource(), now: () => 100 });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "cursor", { role: "user", message: { content: [{ type: "text", text: "Cursor prompt" }] } }, { providerSessionId: "cursor-session" });
  await agents.ingestJournalRecord(identity, "cursor", { type: "turn_ended", status: "success" }, { providerSessionId: "cursor-session" });
  await agents.ingestJournalRecord(identity, "cursor", { type: "terminay.session_metadata" }, { providerSessionId: "cursor-session", providerDisplayName: "Renamed Cursor Session" });
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.provider, "cursor"); assert.equal(entry.sessionId, "cursor-session");
  assert.equal(entry.promptText, "Cursor prompt"); assert.equal(entry.displayName, "Renamed Cursor Session"); assert.equal(entry.state, "done");
  await agents.stop();
});

test("OMP model metadata preserves the current lifecycle state", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const source = fakeJournalSource();
  const agents = new AgentStatusService({ activity, journalSource: source, now: () => 100 });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "omp", { type: "session", id: "omp-session" });
  await agents.ingestJournalRecord(identity, "omp", {
    type: "message", id: "user-1", message: { role: "user", content: "A bounded prompt" },
  });
  await agents.ingestJournalRecord(identity, "omp", {
    type: "model_change", model: "openai-codex/gpt-5.6-terra",
  });
  const root = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "root");
  assert.deepEqual({ state: root?.state, model: root?.model?.id }, {
    state: "working", model: "openai-codex/gpt-5.6-terra",
  });
  assert.equal(activity.snapshot().sessions[identity.sessionId].providerState, "working");
  await agents.stop();
});

test("records cannot cross exact terminal scope and content records are ignored", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const source = fakeJournalSource();
  const agents = new AgentStatusService({ activity, journalSource: source });
  await agents.start(); agents.register(identity);
  await assert.rejects(() => agents.ingestJournalRecord({ ...identity, projectId: "other" }, "codex", { type: "session_meta", payload: { id: "bad" } }), /not active/u);
  assert.equal(await agents.ingestJournalRecord(identity, "codex", { type: "response_item", payload: { type: "message", content: "private" } }), false);
  assert.equal(Object.keys(agents.getSnapshot().entries).length, 0);
  await agents.stop();
});

test("a claimed extension provider owns one terminal and public lifecycle DTOs receive canonical ordering", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, journalSource: fakeJournalSource(), now: () => 100 });
  await agents.start(); agents.register(identity);
  const provider = "com.example.agent/example";

  assert.equal(agents.claimExtensionProvider(identity, provider), true);
  assert.equal(agents.claimExtensionProvider(identity, provider), false);
  // The formerly authoritative built-in journal route cannot publish beside a
  // claimed extension provider for this terminal incarnation.
  assert.equal(await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "legacy" } }), false);

  assert.equal(agents.bindExtensionSession(identity, provider, "0.1", {
    providerSessionId: "provider-session",
    mappingVersion: "0.1",
    fingerprint: { kind: "process-bound", process: { id: "process-1" } },
  }), true);
  const result = await agents.ingestExtensionLifecycle(identity, provider, "0.1", undefined, [
    { kind: "session.started", title: "Extension title", model: { id: "example-1", displayName: "Example 1" } },
    { kind: "turn.started", turnId: "turn-1", promptText: "Use public lifecycle events" },
    { kind: "wait.started", waitId: "wait-1", state: "waiting", reason: "Permission required" },
  ]);
  assert.deepEqual(result, { acceptedEventCount: 3, rejectedEventCount: 0 });
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.deepEqual({
    provider: entry.provider,
    sessionId: entry.sessionId,
    displayName: entry.displayName,
    promptText: entry.promptText,
    model: entry.model?.id,
    state: entry.state,
    sequence: entry.lastEventSequence,
  }, {
    provider,
    sessionId: "provider-session",
    displayName: "Extension title",
    promptText: "Use public lifecycle events",
    model: "example-1",
    state: "waiting",
    sequence: 3,
  });
  assert.equal(activity.snapshot().sessions[identity.sessionId].source, `extension:${provider}`);

  assert.equal(agents.releaseExtensionProvider(identity, provider), true);
  assert.equal(Object.values(agents.getSnapshot().entries)[0].active, false);
  await agents.stop();
});

test("extension lifecycle publication rejects an unclaimed or cross-project terminal scope", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, journalSource: fakeJournalSource() });
  await agents.start(); agents.register(identity);
  const provider = "com.example.agent/example";
  const unclaimed = await agents.ingestExtensionLifecycle(identity, provider, "0.1", undefined, []);
  assert.match(unclaimed.failure, /does not own/u);
  await assert.rejects(() => Promise.resolve(agents.claimExtensionProvider({ ...identity, projectId: "other-project" }, provider)), /not active/u);
  await agents.stop();
});

test("current Codex collaboration records create a named child beneath the root", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const source = fakeJournalSource(); const agents = new AgentStatusService({ activity, journalSource: source, now: () => 100 });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "root-thread", cli_version: "0.149.0" } });
  await agents.ingestJournalRecord(identity, "codex", { type: "event_msg", payload: {
    type: "collab_agent_spawn_end", sender_thread_id: "root-thread", new_thread_id: "child-thread",
    new_agent_nickname: "Ada", new_agent_role: "explorer", prompt: "Inspect the parser", status: "running",
  } });
  const entries = Object.values(agents.getSnapshot().entries);
  const child = entries.find((entry) => entry.kind === "subagent");
  assert.deepEqual({
    displayName: child?.displayName, promptText: child?.promptText, parentAgentId: child?.parentAgentId,
    parentEntryId: child?.parentEntryId, state: child?.state, active: child?.active,
  }, {
    displayName: "Ada", promptText: "Inspect the parser", parentAgentId: "root-thread",
    parentEntryId: "terminal-1:root-thread:root-thread", state: "working", active: true,
  });
  await agents.ingestJournalRecord(identity, "codex", { type: "event_msg", payload: {
    type: "collab_agent_interaction_end", receiver_thread_id: "child-thread", status: { completed: "private result" },
  } });
  const completedChild = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "subagent");
  assert.deepEqual({ state: completedChild?.state, active: completedChild?.active, outcome: completedChild?.completionOutcome }, {
    state: "done", active: true, outcome: "success",
  });
  await agents.stop();
});

test("the first genuine Codex prompt remains the root session label", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const source = fakeJournalSource(); const agents = new AgentStatusService({ activity, journalSource: source, now: () => 100 });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "root-thread", cli_version: "0.149.0" } });
  const rawMessage = (text) => ({ type: "response_item", payload: {
    type: "message", role: "user", content: [{ type: "input_text", text }],
  } });
  const completedMessage = (text, id) => ({ type: "event_msg", payload: {
    type: "item_completed", item: { type: "UserMessage", id, content: [{ type: "text", text, text_elements: [] }] },
  } });
  assert.equal(await agents.ingestJournalRecord(identity, "codex", rawMessage("# AGENTS.md instructions\nInjected context")), false);
  assert.equal(await agents.ingestJournalRecord(identity, "codex", rawMessage("hi")), false);
  await agents.ingestJournalRecord(identity, "codex", completedMessage("hi", "user-message-1"));
  assert.equal(await agents.ingestJournalRecord(identity, "codex", rawMessage("a later follow-up")), false);
  await agents.ingestJournalRecord(identity, "codex", completedMessage("a later follow-up", "user-message-2"));
  const root = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "root");
  assert.equal(root?.promptText, "hi");
  await agents.stop();
});

test("a new process-bound rollout retires the old root and admits the fresh session", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const source = fakeJournalSource(); const agents = new AgentStatusService({ activity, journalSource: source, now: () => 100 });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "old-root", cli_version: "0.149.0" } });
  await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "fresh-root", cli_version: "0.149.0" } });
  const roots = Object.values(agents.getSnapshot().entries).filter((entry) => entry.kind === "root");
  assert.deepEqual(roots.map(({ sessionId, active }) => ({ sessionId, active })), [
    { sessionId: "old-root", active: false },
    { sessionId: "fresh-root", active: true },
  ]);
  await agents.stop();
});

test("current Codex item records replay all subagents into the root session", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const source = fakeJournalSource(); const agents = new AgentStatusService({ activity, journalSource: source, now: () => 100 });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "root-thread", cli_version: "0.149.0" } });
  for (const [id, nickname] of [["child-a", "Gauss"], ["child-b", "Popper"], ["child-c", "Jason"]]) {
    await agents.ingestJournalRecord(identity, "codex", { type: "event_msg", payload: { type: "item_completed", item: {
      type: "CollabAgentToolCall", tool: "spawn_agent", sender_thread_id: "root-thread",
      receiver_thread_ids: [id], receiver_agents: [{ thread_id: id, agent_nickname: nickname }], prompt: "Solve independently",
    } } });
  }
  await agents.ingestJournalRecord(identity, "codex", { type: "event_msg", payload: { type: "item_completed", item: {
    type: "CollabAgentToolCall", tool: "wait", agents_states: {
      "child-a": { completed: "private result" }, "child-b": { completed: "private result" }, "child-c": { completed: "private result" },
    },
  } } });
  const children = Object.values(agents.getSnapshot().entries).filter((entry) => entry.kind === "subagent");
  assert.deepEqual(children.map(({ displayName, state }) => ({ displayName, state })), [
    { displayName: "Gauss", state: "done" },
    { displayName: "Popper", state: "done" },
    { displayName: "Jason", state: "done" },
  ]);
  await agents.stop();
});

test("Claude title, model, tools, and Agent subagents reduce from session records", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const source = fakeJournalSource(); let now = 0;
  const agents = new AgentStatusService({ activity, journalSource: source, now: () => ++now });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "claude-code", { type: "permission-mode", mode: "default", sessionId: "claude-root", version: "2.1.201" });
  await agents.ingestJournalRecord(identity, "claude-code", { type: "user", sessionId: "claude-root", promptId: "prompt-1", message: { role: "user", content: [{ type: "text", text: "private prompt" }] } });
  await agents.ingestJournalRecord(identity, "claude-code", { type: "ai-title", sessionId: "claude-root", aiTitle: "Add white background to text" });
  await agents.ingestJournalRecord(identity, "claude-code", { type: "assistant", sessionId: "claude-root", message: {
    role: "assistant", model: "claude-opus-4-8", content: [{ type: "tool_use", id: "toolu-agent-1", name: "Agent", input: {
      description: "Research parser", prompt: "Inspect the journal", subagent_type: "general-purpose",
    } }],
  } });
  await agents.ingestJournalRecord(identity, "claude-code", { type: "user", sessionId: "claude-root", message: {
    role: "user", content: [{ type: "tool_result", tool_use_id: "toolu-agent-1", is_error: false, content: "private result" }],
  } });
  const entries = Object.values(agents.getSnapshot().entries);
  const root = entries.find((entry) => entry.kind === "root"); const child = entries.find((entry) => entry.kind === "subagent");
  assert.deepEqual({ prompt: root?.promptText, model: root?.model?.id, state: root?.state }, {
    prompt: "Add white background to text", model: "claude-opus-4-8", state: "working",
  });
  assert.deepEqual({ name: child?.displayName, prompt: child?.promptText, state: child?.state, outcome: child?.completionOutcome }, {
    name: "Research parser", prompt: "Inspect the journal", state: "done", outcome: "success",
  });
  await agents.stop();
});

test("disabling stops observation and clears reduced state", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const source = fakeJournalSource(); const agents = new AgentStatusService({ activity, journalSource: source });
  await agents.start(); agents.register(identity);
  await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "session" } });
  assert.equal(Object.keys(agents.getSnapshot().entries).length, 1);
  assert.equal(agents.setIntegrationEnabled(false), true);
  assert.equal(Object.keys(agents.getSnapshot().entries).length, 0);
  assert(source.calls.some(([kind, enabled]) => kind === "enabled" && enabled === false));
  await agents.stop();
});
