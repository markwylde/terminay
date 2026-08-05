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
