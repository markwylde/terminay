import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, TerminalActivityService, TerminalService, composeActivityLifecycle } from "../dist/index.js";

test("terminal lifecycle registers the exact spawned session with the generic agent projection", async () => {
  const activity = new TerminalActivityService({ serverId: "server-1" });
  const agents = new AgentStatusService({ activity }); await agents.start();
  const process = { pid: 9876, write() {}, resize() {}, kill() {}, onData() { return () => {}; }, onExit() { return () => {}; } };
  const terminal = new TerminalService({ serverId: "server-1", ptyFactory: { spawn: () => process }, sessionLifecycle: composeActivityLifecycle(activity, agents, undefined) });
  await terminal.createSession({ projectId: "project-1", sessionId: "terminal-1", shellPath: "/bin/sh", cols: 80, rows: 24 });
  assert.equal(agents.isSessionActive({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" }), true);
  await terminal.shutdown(); await agents.stop();
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
    foregroundObservation: "available",
    projectId: "project-1",
    sessionId: "terminal-1",
    source: "structured:foreground",
    status: "working",
    updatedAt: activity.get({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" }).updatedAt,
  });
  await terminal.shutdown();
  assert.equal(foregroundListener, undefined);
});
