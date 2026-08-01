import assert from "node:assert/strict";
import test from "node:test";
import { TerminalActivityService, TerminalService, WorkspaceRepository } from "@terminay/server-core";
import { createServerTerminalControlAdapter, createTerminalControlAdapter } from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 9000 + processes.length,
        options,
        writes: [],
        kills: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize() {},
        kill(signal) { this.kills.push(signal); },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; for (const listener of dataListeners) listener(bytes); },
        emitExit(exit = {}) { for (const listener of exitListeners) listener(exit); },
      };
      processes.push(process);
      return process;
    },
  };
}

function context() {
  return {
    terminalSessionId: "caller",
    projectId: "project-a",
    scope: "write",
    connectionId: "local",
    requestId: "request",
    signal: new AbortController().signal,
  };
}

test("server terminal adapter wires bounded PTY operations to implicit project scope", async () => {
  const pty = createPtyFactory();
  const ids = ["caller", "sibling", "opened"];
  const terminal = new TerminalService({ serverId: "server-a", ptyFactory: pty, generateSessionId: () => ids.shift() });
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const caller = await terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const sibling = await terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  activity.register({ serverId: "server-a", projectId: "project-a", sessionId: caller.sessionId });
  activity.register({ serverId: "server-a", projectId: "project-a", sessionId: sibling.sessionId });
  const layoutCalls = [];
  const adapter = createServerTerminalControlAdapter({
    terminal,
    activity,
    focusTerminal: (params) => { layoutCalls.push(["focus", params]); return { focused: params.terminal }; },
    renameTerminal: (params) => { layoutCalls.push(["rename", params]); return { renamed: params.name }; },
    splitTerminal: (params) => { layoutCalls.push(["split", params]); return { split: params.direction }; },
  });
  const dispatch = createTerminalControlAdapter({ adapter });
  const request = (id, op, params) => dispatch({ id, version: 1, op, params }, { ...context(), requestId: id });

  const listed = await request("list", "list_terminals", {});
  assert.equal(listed.terminals.length, 2);
  pty.processes[1].emitData("line one\nline two\n");
  assert.deepEqual(await request("read", "read_terminal", { terminal: "sibling", lines: 1 }), { terminal: "sibling", output: "line two\n", truncated: true });

  const written = await request("write", "write_terminal", { terminal: "sibling", text: "echo ok", submit: true });
  assert.equal(written.submitted, true);
  assert.equal(new TextDecoder().decode(pty.processes[1].writes[0]), "echo ok\r");
  await request("run", "run_command", { terminal: "sibling", command: "printf ok" });
  assert.match(new TextDecoder().decode(pty.processes[1].writes[1]), /printf ok/);
  assert.equal((await request("status", "get_terminal_status", { terminal: "sibling" })).status, "running");
  assert.deepEqual(await request("focus", "focus_terminal", { terminal: "sibling" }), { focused: "sibling" });
  assert.deepEqual(await request("rename", "rename_terminal", { terminal: "sibling", name: "Worker" }), { renamed: "Worker" });
  assert.deepEqual(await request("split", "split_terminal", { terminal: "sibling", direction: "below" }), { split: "below" });
  assert.equal(layoutCalls.length, 3);
  assert.deepEqual(await request("open", "open_terminal", { name: "New" }), { terminal: "opened", projectId: "project-a", status: "running" });
  assert.deepEqual(await request("close", "close_terminal", { terminal: "sibling" }), { terminal: "sibling", closed: true });
  assert.deepEqual(pty.processes[1].kills, [undefined]);

  const otherProject = await terminal.createSession({ projectId: "project-b", cols: 80, rows: 24, sessionId: "other" });
  assert.equal(otherProject.projectId, "project-b");
  const denied = await request("cross", "read_terminal", { terminal: "other" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "terminal_not_found");
});

test("server terminal adapter binds layout operations to the canonical workspace repository", async () => {
  const pty = createPtyFactory();
  const ids = ["caller", "sibling"];
  const terminal = new TerminalService({ serverId: "server-a", ptyFactory: pty, generateSessionId: () => ids.shift() });
  const caller = await terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const sibling = await terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  let persisted;
  const workspace = new WorkspaceRepository({
    async load() { return persisted; },
    async commit(state) { persisted = state; },
  }, "server-a");
  const initial = await workspace.load();
  const viewId = initial.viewOrder[0];
  await workspace.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId, root: "/workspace", name: "Project" } });
  await workspace.apply({ commandId: "caller", command: { type: "terminal.create", sessionId: caller.sessionId, projectId: "project-a", createdAt: 1 } });
  await workspace.apply({ commandId: "sibling", command: { type: "terminal.create", sessionId: sibling.sessionId, projectId: "project-a", createdAt: 2 } });
  await workspace.apply({ commandId: "caller-panel", command: { type: "panel.create", panel: { id: "panel-caller", projectId: "project-a", type: "terminal", sessionId: caller.sessionId, createdAt: 1 } } });
  await workspace.apply({ commandId: "sibling-panel", command: { type: "panel.create", panel: { id: "panel-sibling", projectId: "project-a", type: "terminal", sessionId: sibling.sessionId, createdAt: 2 } } });

  const adapter = createServerTerminalControlAdapter({
    terminal,
    workspace,
    focusTerminal: () => { throw new Error("renderer focus callback must not run"); },
    renameTerminal: () => { throw new Error("renderer rename callback must not run"); },
    splitTerminal: () => { throw new Error("renderer split callback must not run"); },
  });
  const dispatch = createTerminalControlAdapter({ adapter });
  const request = (id, op, params) => dispatch({ id, version: 1, op, params }, { ...context(), requestId: id });

  assert.deepEqual(await request("workspace-focus", "focus_terminal", { terminal: "sibling" }), { terminal: "sibling", focused: true });
  assert.deepEqual(await request("workspace-rename", "rename_terminal", { terminal: "sibling", name: "Worker" }), { terminal: "sibling", renamed: true, name: "Worker" });
  assert.deepEqual(await request("workspace-split", "split_terminal", { terminal: "sibling", direction: "below" }), { terminal: "sibling", split: "below" });
  const updated = await workspace.load();
  assert.equal(updated.panels["panel-sibling"].title, "Worker");
  assert.equal(updated.projects["project-a"].activePanelId, "panel-sibling");
  assert.equal(updated.projects["project-a"].layout.kind, "split");
  assert.equal(updated.projects["project-a"].layout.direction, "vertical");

  const movedViewId = `${viewId}:other`;
  await workspace.apply({ commandId: "view-other", command: { type: "view.create", viewId: movedViewId, name: "Other" } });
  await workspace.apply({ commandId: "move-project", command: { type: "project.move", projectId: "project-a", targetViewId: movedViewId } });
  const moved = await request("workspace-moved", "focus_terminal", { terminal: "sibling" });
  assert.deepEqual(moved, { terminal: "sibling", focused: true });
  assert.equal((await workspace.load()).projects["project-a"].viewId, movedViewId);
});

test("server terminal adapter waits on canonical activity transitions with bounded timeout", async () => {
  const pty = createPtyFactory();
  const terminal = new TerminalService({ serverId: "server-a", ptyFactory: pty, generateSessionId: () => "caller" });
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const handle = await terminal.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: handle.sessionId };
  activity.register(identity);
  const dispatch = createTerminalControlAdapter({ adapter: createServerTerminalControlAdapter({ terminal, activity, maxWaitSeconds: 2 }) });
  const request = (id, op, params) => dispatch({ id, version: 1, op, params }, { ...context(), requestId: id });

  activity.ingestSignal(identity, { kind: "command", phase: "executing" });
  const idlePending = request("idle", "wait_for_idle", { terminal: "caller", seconds: 1, timeout: 1 });
  setTimeout(() => activity.ingestSignal(identity, { kind: "command", phase: "finished", exitCode: 7 }), 5);
  assert.deepEqual(await idlePending, { terminal: "caller", idle: true, timedOut: false, exitCode: 7 });

  const commandPending = request("command", "wait_for_command", { terminal: "caller", timeout: 1 });
  setTimeout(() => {
    activity.ingestSignal(identity, { kind: "command", phase: "executing" });
    activity.ingestSignal(identity, { kind: "command", phase: "finished", exitCode: 3 });
  }, 5);
  assert.deepEqual(await commandPending, { terminal: "caller", completed: true, timedOut: false, exitCode: 3 });

  const attentionPending = request("attention", "wait_for_attention", { terminal: "caller", timeout: 1 });
  setTimeout(() => activity.ingestSignal(identity, { kind: "bell" }), 5);
  assert.deepEqual(await attentionPending, { terminal: "caller", attention: true, timedOut: false, exitCode: 3 });

  activity.ingestSignal(identity, { kind: "userInput" });
  assert.deepEqual(
    await request("zero-idle", "wait_for_idle", { terminal: "caller", seconds: 0 }),
    { terminal: "caller", idle: true, timedOut: false, exitCode: 3 },
  );
  assert.deepEqual(await request("timeout", "wait_for_attention", { terminal: "caller", timeout: 0.01 }), { terminal: "caller", attention: false, timedOut: true });
});
