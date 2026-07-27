import assert from "node:assert/strict";
import test from "node:test";
import { ControlEndpointError, createTerminalControlAdapter } from "../dist/index.js";

const baseContext = {
  terminalSessionId: "caller",
  projectId: "project-a",
  scope: "write",
  connectionId: "local",
  requestId: "one",
  signal: new AbortController().signal,
};

test("typed terminal adapter routes every operation with implicit scope", async () => {
  const calls = [];
  const backend = {
    listTerminals: (context, signal) => { calls.push(["list", context.projectId, signal, "token" in context]); return { terminals: [] }; },
    readTerminal: (params, context) => { calls.push(["read", params, context.terminalSessionId]); return { output: "ok" }; },
    getTerminalStatus: (params) => { calls.push(["status", params]); return { status: "idle" }; },
    openTerminal: (params) => { calls.push(["open", params]); return { id: "new", name: params.name ?? "new" }; },
    writeTerminal: (params) => { calls.push(["write", params]); return { ok: true }; },
    runCommand: (params) => { calls.push(["run", params]); return { ok: true }; },
    closeTerminal: (params) => { calls.push(["close", params]); return { ok: true }; },
    focusTerminal: (params) => { calls.push(["focus", params]); return { ok: true }; },
    renameTerminal: (params) => { calls.push(["rename", params]); return { id: params.terminal, name: params.name }; },
    splitTerminal: (params) => { calls.push(["split", params]); return { id: "split", name: "split" }; },
    waitForIdle: (params) => { calls.push(["idle", params]); return { idle: true, timedOut: false }; },
    waitForCommand: (params) => { calls.push(["command", params]); return { exitCode: 0, timedOut: false }; },
    waitForAttention: (params) => { calls.push(["attention", params]); return { attention: true, timedOut: false }; },
  };
  const dispatch = createTerminalControlAdapter({ adapter: backend });
  const operations = [
    ["list_terminals", {}],
    ["read_terminal", { terminal: "worker", lines: 10 }],
    ["get_terminal_status", { terminal: "worker" }],
    ["open_terminal", { name: "new", cwd: "/workspace", split: "right" }],
    ["write_terminal", { terminal: "worker", text: "echo ok", submit: true }],
    ["run_command", { terminal: "worker", command: "printf ok" }],
    ["close_terminal", { terminal: "worker" }],
    ["focus_terminal", { terminal: "worker" }],
    ["rename_terminal", { terminal: "worker", name: "Worker" }],
    ["split_terminal", { terminal: "worker", direction: "below" }],
    ["wait_for_idle", { terminal: "worker", seconds: 1, timeout: 5 }],
    ["wait_for_command", { terminal: "worker", timeout: 5 }],
    ["wait_for_attention", { terminal: "worker", timeout: 5 }],
  ];
  for (const [index, [op, params]] of operations.entries()) {
    const result = await dispatch({ id: `request-${index}`, version: 1, op, params }, { ...baseContext, requestId: `request-${index}` });
    assert.notEqual(result?.ok, false, `${op} should succeed`);
  }
  assert.equal(calls.length, operations.length);
  assert.equal(calls[0][1], "project-a");
  assert.equal(calls[0][3], false);
  assert.equal(calls[1][1].lines, 10);
  assert.equal("token" in calls[0], false);
});

test("typed terminal adapter resolves canonical list/read/status/wait results directly", async () => {
  const seen = [];
  const backend = {
    listTerminals: (context, signal) => {
      seen.push(["list", context.projectId, context.terminalSessionId, signal.aborted]);
      return { terminals: [{ id: "sibling", state: "idle", projectId: context.projectId }] };
    },
    readTerminal: (params, context, signal) => {
      seen.push(["read", params.terminal, params.lines, context.projectId, signal.aborted]);
      return { terminal: params.terminal, output: "bounded output", truncated: false };
    },
    getTerminalStatus: (params, context, signal) => {
      seen.push(["status", params.terminal, context.projectId, signal.aborted]);
      return { terminal: params.terminal, status: "idle", attention: false, lastExitCode: 0 };
    },
    waitForIdle: async (params, context, signal) => {
      seen.push(["idle", params.terminal, params.seconds, params.timeout, context.projectId, signal.aborted]);
      return { terminal: params.terminal, idle: true, timedOut: false };
    },
    waitForCommand: (params, context, signal) => {
      seen.push(["command", params.terminal, params.timeout, context.projectId, signal.aborted]);
      return { terminal: params.terminal, completed: true, exitCode: 0, timedOut: false };
    },
    waitForAttention: (params, context, signal) => {
      seen.push(["attention", params.terminal, params.timeout, context.projectId, signal.aborted]);
      return { terminal: params.terminal, attention: false, timedOut: true };
    },
    // The remaining methods are required by the typed adapter boundary even
    // though this test intentionally exercises only read-only operations.
    openTerminal: () => ({}),
    writeTerminal: () => ({}),
    runCommand: () => ({}),
    closeTerminal: () => ({}),
    focusTerminal: () => ({}),
    renameTerminal: () => ({}),
    splitTerminal: () => ({}),
  };
  const dispatch = createTerminalControlAdapter({ adapter: backend });
  const request = (id, op, params) => dispatch({ id, version: 1, op, params }, { ...baseContext, requestId: id });

  assert.deepEqual(await request("list", "list_terminals", {}), { terminals: [{ id: "sibling", state: "idle", projectId: "project-a" }] });
  assert.deepEqual(await request("read", "read_terminal", { terminal: "sibling", lines: 32 }), { terminal: "sibling", output: "bounded output", truncated: false });
  assert.deepEqual(await request("status", "get_terminal_status", { terminal: "sibling" }), { terminal: "sibling", status: "idle", attention: false, lastExitCode: 0 });
  assert.deepEqual(await request("idle", "wait_for_idle", { terminal: "sibling", seconds: 1, timeout: 5 }), { terminal: "sibling", idle: true, timedOut: false });
  assert.deepEqual(await request("command", "wait_for_command", { terminal: "sibling", timeout: 5 }), { terminal: "sibling", completed: true, exitCode: 0, timedOut: false });
  assert.deepEqual(await request("attention", "wait_for_attention", { terminal: "sibling", timeout: 5 }), { terminal: "sibling", attention: false, timedOut: true });
  assert.deepEqual(seen, [
    ["list", "project-a", "caller", false],
    ["read", "sibling", 32, "project-a", false],
    ["status", "sibling", "project-a", false],
    ["idle", "sibling", 1, 5, "project-a", false],
    ["command", "sibling", 5, "project-a", false],
    ["attention", "sibling", 5, "project-a", false],
  ]);
});

test("typed terminal adapter reports ambiguity and backend timeout without renderer fallback", async () => {
  const dispatch = createTerminalControlAdapter({
    adapter: {
      listTerminals: () => [],
      readTerminal: () => { throw new ControlEndpointError("ambiguous_terminal", "more than one terminal matches", ["worker-a", "worker-b"]); },
      getTerminalStatus: () => { throw Object.assign(new Error("session has exited"), { code: "session_exited" }); },
      openTerminal: () => ({}),
      writeTerminal: () => ({}),
      runCommand: () => ({}),
      closeTerminal: () => ({}),
      focusTerminal: () => ({}),
      renameTerminal: () => ({}),
      splitTerminal: () => ({}),
      waitForIdle: () => { throw Object.assign(new Error("wait deadline exceeded"), { code: "timeout" }); },
      waitForCommand: () => ({}),
      waitForAttention: () => ({}),
    },
  });
  const ambiguous = await dispatch({ id: "ambiguous", version: 1, op: "read_terminal", params: { terminal: "worker" } }, baseContext);
  assert.deepEqual(ambiguous, {
    ok: false,
    error: { code: "ambiguous_terminal", message: "more than one terminal matches", candidates: ["worker-a", "worker-b"] },
  });
  const timedOut = await dispatch({ id: "timeout", version: 1, op: "wait_for_idle", params: { terminal: "worker", seconds: 1 } }, baseContext);
  assert.deepEqual(timedOut, { ok: false, error: { code: "timeout", message: "wait deadline exceeded" } });
  const exited = await dispatch({ id: "exited", version: 1, op: "get_terminal_status", params: { terminal: "worker" } }, baseContext);
  assert.deepEqual(exited, { ok: false, error: { code: "terminal_not_found", message: "The requested terminal is unavailable." } });
});

test("typed terminal adapter bounds parameters and preserves scope errors", async () => {
  let invoked = 0;
  const dispatch = createTerminalControlAdapter({
    maxTextBytes: 4,
    adapter: {
      listTerminals: () => [],
      readTerminal: () => [],
      getTerminalStatus: () => ({}),
      openTerminal: () => ({}),
      writeTerminal: () => { invoked += 1; return { ok: true }; },
      runCommand: () => ({}),
      closeTerminal: () => ({}),
      focusTerminal: () => ({}),
      renameTerminal: () => ({}),
      splitTerminal: () => ({}),
      waitForIdle: () => ({}),
      waitForCommand: () => ({}),
      waitForAttention: () => ({}),
    },
  });
  const oversized = await dispatch({ id: "oversized", version: 1, op: "write_terminal", params: { terminal: "worker", text: "ééé" } }, baseContext);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.code, "bad_request");
  assert.equal(invoked, 0);
  const denied = await dispatch({ id: "denied", version: 1, op: "write_terminal", params: { terminal: "worker", text: "ok" } }, { ...baseContext, scope: "read" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "forbidden");
  const malformed = await dispatch({ id: "malformed", version: 1, op: "wait_for_idle", params: { terminal: "worker", seconds: 0 } }, baseContext);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "bad_request");
});

test("typed terminal adapter bounds every wait lifetime before invoking server handlers", async () => {
  let waitCalls = 0;
  const backend = {
    listTerminals: () => [],
    readTerminal: () => [],
    getTerminalStatus: () => ({}),
    openTerminal: () => ({}),
    writeTerminal: () => ({}),
    runCommand: () => ({}),
    closeTerminal: () => ({}),
    focusTerminal: () => ({}),
    renameTerminal: () => ({}),
    splitTerminal: () => ({}),
    waitForIdle: () => { waitCalls += 1; return { idle: true }; },
    waitForCommand: () => { waitCalls += 1; return { completed: true }; },
    waitForAttention: () => { waitCalls += 1; return { attention: true }; },
  };
  const dispatch = createTerminalControlAdapter({ adapter: backend, maxWaitSeconds: 2 });
  const requests = [
    ["wait_for_idle", { terminal: "worker", seconds: 3 }],
    ["wait_for_command", { terminal: "worker", timeout: 3 }],
    ["wait_for_attention", { terminal: "worker", timeout: 3 }],
  ];
  for (const [index, [op, params]] of requests.entries()) {
    const result = await dispatch({ id: `wait-${index}`, version: 1, op, params }, { ...baseContext, requestId: `wait-${index}` });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "bad_request");
  }
  assert.equal(waitCalls, 0);
});

test("typed terminal adapter cancels before and during backend work and bounds typed errors", async () => {
  let invoked = 0;
  const dispatch = createTerminalControlAdapter({
    adapter: {
      listTerminals: () => [],
      readTerminal: () => [],
      getTerminalStatus: () => ({}),
      openTerminal: () => ({}),
      writeTerminal: async (_params, _context, signal) => {
        invoked += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return signal.aborted ? { ignored: true } : { ok: true };
      },
      runCommand: () => ({}),
      closeTerminal: () => { throw new ControlEndpointError("terminal_not_found", "private detail", ["worker"]); },
      focusTerminal: () => { throw Object.assign(new Error("private service detail"), { code: "session_exited" }); },
      renameTerminal: () => ({}),
      splitTerminal: () => ({}),
      waitForIdle: () => ({}),
      waitForCommand: () => ({}),
      waitForAttention: () => ({}),
    },
  });
  const before = new AbortController();
  before.abort();
  const cancelledBefore = await dispatch({ id: "before", version: 1, op: "write_terminal", params: { terminal: "worker", text: "ok" } }, { ...baseContext, signal: before.signal });
  assert.equal(cancelledBefore.ok, false);
  assert.equal(cancelledBefore.error.code, "cancelled");
  assert.equal(invoked, 0);

  const during = new AbortController();
  const pending = dispatch({ id: "during", version: 1, op: "write_terminal", params: { terminal: "worker", text: "ok" } }, { ...baseContext, signal: during.signal });
  setTimeout(() => during.abort(), 1);
  const cancelledDuring = await pending;
  assert.equal(cancelledDuring.ok, false);
  assert.equal(cancelledDuring.error.code, "cancelled");
  assert.equal(invoked, 1);

  const typed = await dispatch({ id: "typed", version: 1, op: "close_terminal", params: { terminal: "worker" } }, baseContext);
  assert.deepEqual(typed, { ok: false, error: { code: "terminal_not_found", message: "private detail", candidates: ["worker"] } });
  const mapped = await dispatch({ id: "mapped", version: 1, op: "focus_terminal", params: { terminal: "worker" } }, baseContext);
  assert.deepEqual(mapped, { ok: false, error: { code: "terminal_not_found", message: "The requested terminal is unavailable." } });
});
