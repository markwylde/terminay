import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, TerminalActivityService, TerminalService, composeActivityLifecycle } from "../dist/index.js";

test("terminal lifecycle forwards the exact spawned PTY shell PID to journal observation", async () => {
  const calls = [];
  const journalSource = {
    async start() {}, async stop() {}, setEnabled() {},
    registerTerminal(identity) { calls.push(["register", identity.sessionId]); },
    terminalStarted(identity, pid) { calls.push(["started", identity.sessionId, pid]); },
    foregroundProcessChanged() {}, unregisterTerminal() {},
  };
  const activity = new TerminalActivityService({ serverId: "server-1" });
  const agents = new AgentStatusService({ activity, journalSource }); await agents.start();
  const process = { pid: 9876, write() {}, resize() {}, kill() {}, onData() { return () => {}; }, onExit() { return () => {}; } };
  const terminal = new TerminalService({ serverId: "server-1", ptyFactory: { spawn: () => process }, sessionLifecycle: composeActivityLifecycle(activity, agents, undefined) });
  await terminal.createSession({ projectId: "project-1", sessionId: "terminal-1", shellPath: "/bin/sh", cols: 80, rows: 24 });
  assert.deepEqual(calls.slice(0, 2), [["register", "terminal-1"], ["started", "terminal-1", 9876]]);
  await terminal.shutdown(); await agents.stop();
});

test("provider-neutral PTY journal callback feeds only the reduced authoritative agent projection", async () => {
  const activity = new TerminalActivityService({ serverId: "server-1" });
  const inertJournal = { async start() {}, async stop() {}, setEnabled() {}, registerTerminal() {}, terminalStarted() {}, foregroundProcessChanged() {}, unregisterTerminal() {} };
  const agents = new AgentStatusService({ activity, journalSource: inertJournal, now: () => 100 }); await agents.start();
  let journalListener;
  const process = { write() {}, resize() {}, kill() {}, onData() { return () => {}; }, onExit() { return () => {}; }, onAgentJournal(listener) { journalListener = listener; return () => { journalListener = undefined; }; } };
  const terminal = new TerminalService({ serverId: "server-1", ptyFactory: { spawn: () => process }, sessionLifecycle: composeActivityLifecycle(activity, agents, undefined) });
  await terminal.createSession({ projectId: "project-remote", sessionId: "remote-terminal", shellPath: "/bin/sh", cols: 80, rows: 24 });
  journalListener({ provider: "codex", record: { type: "session_meta", payload: { id: "remote-codex", cli_version: "0.2.0", rawPrompt: "never expose" } } });
  journalListener({ provider: "codex", record: { type: "event_msg", payload: { type: "task_started", rawResponse: "never expose" } } });
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = agents.getSnapshotForProject("project-remote");
  assert.equal(Object.values(snapshot.entries)[0].sessionId, "remote-codex");
  assert.doesNotMatch(JSON.stringify(snapshot), /never expose/u);
  await terminal.shutdown(); assert.equal(journalListener, undefined); await agents.stop();
});

test("foreground PTY lifecycle reaches the exact canonical activity session", async () => {
  const activity = new TerminalActivityService({ serverId: "server-1" });
  let foregroundListener;
  const process = {
    write() {}, resize() {}, kill() {},
    onData() { return () => {}; },
    onExit() { return () => {}; },
    onForegroundProcess(listener) { foregroundListener = listener; return () => { foregroundListener = undefined; }; },
  };
  const terminal = new TerminalService({
    serverId: "server-1",
    ptyFactory: { spawn: () => process },
    sessionLifecycle: composeActivityLifecycle(activity, undefined, undefined),
  });
  await terminal.createSession({
    projectId: "project-1",
    sessionId: "terminal-1",
    shellPath: "/bin/sh",
    cols: 80,
    rows: 24,
  });

  foregroundListener({ processName: "sleep", shellForeground: false });

  assert.deepEqual(activity.get({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" }), {
    acknowledged: true,
    attention: false,
    authority: "structured",
    claimed: false,
    foregroundBusy: true,
    projectId: "project-1",
    sessionId: "terminal-1",
    source: "structured:foreground",
    status: "working",
    updatedAt: activity.get({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" }).updatedAt,
  });
  await terminal.shutdown();
  assert.equal(foregroundListener, undefined);
});
