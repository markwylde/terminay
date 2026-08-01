import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentStatusService,
  composeActivityLifecycle,
  createNodePtyFactory,
  TERMINAY_AGENT_HOOK_ENDPOINT_ENV,
  TERMINAY_AGENT_HOOK_TOKEN_ENV,
  TERMINAY_SESSION_ID_ENV,
  TerminalActivityService,
  TerminalService,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const exitListeners = new Set();
      const process = {
        options,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => {}; },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitExit(exit = {}) { for (const listener of exitListeners) listener(exit); },
      };
      processes.push(process);
      return process;
    },
  };
}

const identity = (projectId, sessionId) => ({ serverId: "server-a", projectId, sessionId });

test("terminal PTY creation injects server-owned hook credentials and scopes exit cleanup", async () => {
  const pty = createPtyFactory();
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  let tokenNumber = 0;
  const agents = new AgentStatusService({
    activity,
    now: () => 100,
    receiver: { tokenFactory: () => `terminal-hook-token-${++tokenNumber}` },
  });
  await agents.start();

  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    sessionLifecycle: agents,
  });
  const first = await terminal.createSession({
    projectId: "project-a",
    sessionId: "session-a",
    cols: 80,
    rows: 24,
    env: {
      TERM: "xterm",
      [TERMINAY_SESSION_ID_ENV]: "spoofed-session",
      [TERMINAY_AGENT_HOOK_ENDPOINT_ENV]: "http://attacker.invalid/hook",
      [TERMINAY_AGENT_HOOK_TOKEN_ENV]: "spoofed-token",
    },
  });
  const firstEnvironment = pty.processes[0].options.env;
  assert.equal(firstEnvironment.TERM, "xterm");
  assert.equal(firstEnvironment[TERMINAY_SESSION_ID_ENV], "session-a");
  assert.match(firstEnvironment[TERMINAY_AGENT_HOOK_ENDPOINT_ENV], /^http:\/\/127\.0\.0\.1:/);
  assert.equal(firstEnvironment[TERMINAY_AGENT_HOOK_TOKEN_ENV], "terminal-hook-token-1");

  const second = await terminal.createSession({ projectId: "project-b", sessionId: "session-b", cols: 80, rows: 24 });
  assert.equal(pty.processes[1].options.env[TERMINAY_SESSION_ID_ENV], "session-b");
  assert.equal(pty.processes[1].options.env[TERMINAY_AGENT_HOOK_TOKEN_ENV], "terminal-hook-token-2");

  await agents.ingestHookPayload(identity("project-a", "session-a"), "codex", {
    hook_event_name: "SessionStart",
    session_id: "codex-session-a",
  });
  await agents.ingestHookPayload(identity("project-b", "session-b"), "claude-code", {
    hook_event_name: "SessionStart",
    session_id: "claude-session-b",
  });

  pty.processes[0].emitExit({ exitCode: 0, signal: null });
  const entries = Object.values(agents.getSnapshot().entries);
  assert.equal(entries.find((entry) => entry.activationTerminalSessionId === "session-a")?.active, false);
  assert.equal(entries.find((entry) => entry.activationTerminalSessionId === "session-b")?.active, true);
  await assert.rejects(
    () => agents.ingestHookPayload(identity("project-a", "session-a"), "codex", { hook_event_name: "UserPromptSubmit" }),
    /not active/,
  );

  await terminal.shutdown();
  await agents.stop();
  assert.equal(first.status, "exited");
  assert.equal(second.status, "interrupted");
});

test("composed terminal foreground lifecycle retires the matching provider after shell return", async () => {
  const scheduler = createForegroundScheduler();
  const child = createForegroundChild();
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  const agents = new AgentStatusService({
    activity,
    now: () => 100,
    foregroundExitConfirmationMs: 0,
  });
  await agents.start();
  try {
    const terminalIdentity = identity("project-a", "session-a");
    const terminal = new TerminalService({
      serverId: "server-a",
      ptyFactory: createNodePtyFactory(
        { spawn: () => child },
        { foregroundPolling: scheduler },
      ),
      sessionLifecycle: composeActivityLifecycle(activity, agents),
    });
    await terminal.createSession({
      projectId: terminalIdentity.projectId,
      sessionId: terminalIdentity.sessionId,
      cols: 80,
      rows: 24,
      shellPath: "/bin/zsh",
    });
    await agents.ingestHookPayload(terminalIdentity, "codex", {
      hook_event_name: "SessionStart",
      session_id: "codex-a",
    });

    child.process = "codex";
    scheduler.tick();
    assert.equal(Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "root")?.active, true);

    child.process = "zsh";
    scheduler.tick();
    await settleForegroundExit();

    const root = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "root");
    assert.equal(root?.active, false);
    assert.equal(root?.lastEventKind, "session.stopped");
    assert.equal(root?.activationTerminalSessionId, terminalIdentity.sessionId);
    assert.equal(activity.projectIdForSession(root?.activationTerminalSessionId ?? ""), terminalIdentity.projectId);
    assert.equal(terminal.getSession(terminalIdentity.sessionId)?.serverId, terminalIdentity.serverId);

    const revisionAfterShellReturn = agents.getSnapshot().revision;
    scheduler.tick();
    await settleForegroundExit();
    assert.equal(agents.getSnapshot().revision, revisionAfterShellReturn, "unchanged foreground state is deduplicated");

    child.exit();
    assert.equal(scheduler.active.size, 0, "NodePty polling is released when the terminal exits");
    const revisionAfterExit = agents.getSnapshot().revision;
    child.process = "claude";
    scheduler.tick();
    await settleForegroundExit();
    assert.equal(agents.getSnapshot().revision, revisionAfterExit, "post-exit foreground changes never reach the composed authority");
    await terminal.shutdown();
  } finally {
    await agents.stop();
  }
});

function createForegroundScheduler() {
  const active = new Map();
  let nextId = 0;
  return {
    active,
    setInterval(callback, delayMs) {
      const id = ++nextId;
      active.set(id, { callback, delayMs });
      return id;
    },
    clearInterval(id) { active.delete(id); },
    tick() { for (const { callback } of [...active.values()]) callback(); },
  };
}

function createForegroundChild() {
  const dataListeners = new Set();
  const exitListeners = new Set();
  return {
    pid: 42,
    process: "zsh",
    write() {},
    resize() {},
    kill() {},
    onData(listener) {
      dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      return { dispose: () => exitListeners.delete(listener) };
    },
    exit(event = { exitCode: 0 }) {
      for (const listener of [...exitListeners]) listener(event);
    },
  };
}

async function settleForegroundExit() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
