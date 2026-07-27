import assert from "node:assert/strict";
import test from "node:test";
import { TerminalActivityService, TerminalService } from "@terminay/server-core";
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
  assert.deepEqual(await request("timeout", "wait_for_attention", { terminal: "caller", timeout: 0.01 }), { terminal: "caller", attention: false, timedOut: true });
});
