import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, TerminalActivityService } from "../dist/index.js";

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
