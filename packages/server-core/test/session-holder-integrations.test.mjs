import test from "node:test";
import assert from "node:assert/strict";
import { AutomationRunLog, TerminalService } from "../dist/index.js";

/**
 * What the services around a terminal see when the server lets go of it and a
 * later server takes it back (ADR-0035).
 *
 * Agent status binds an agent process to a terminal by process ancestry from
 * the shell's pid (ADR-0025), and the terminal service is what tells it that
 * pid. An adopted session has the same shell, so it must be announced with the
 * same pid, and letting go of it must not be announced as an exit.
 */

const SERVER = "integrations-server";
const identity = (sessionId) => ({ serverId: SERVER, projectId: "p1", sessionId });

function heldProcess(pid) {
  const data = new Set();
  const exits = new Set();
  return {
    ...(pid === undefined ? {} : { pid }),
    disposed: 0,
    write() {},
    resize() {},
    kill() {},
    onData(listener) { data.add(listener); return () => data.delete(listener); },
    onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
    dispose() { this.disposed += 1; },
    exit(code) { for (const listener of [...exits]) listener({ exitCode: code, signal: null }); },
  };
}

function observedService(pty) {
  const calls = [];
  const service = new TerminalService({
    serverId: SERVER,
    ptyFactory: { spawn: () => pty },
    sessionLifecycle: {
      prepareTerminalSession: (id) => { calls.push(["prepare", id.sessionId]); return { TERMINAY_SEEN: "1" }; },
      terminalStarted: (id, pid) => calls.push(["started", id.sessionId, pid]),
      terminalExited: (id, exit) => calls.push(["exited", id.sessionId, exit?.exitCode]),
    },
  });
  return { service, calls };
}

test("an adopted session is announced with the pid its shell has had all along", async () => {
  // First server: spawns the shell.
  const shell = heldProcess(4242);
  const first = observedService(shell);
  await first.service.createSession({ projectId: "p1", sessionId: "s1", shellPath: "/bin/sh", cols: 80, rows: 24 });
  assert.deepEqual(first.calls, [["prepare", "s1"], ["started", "s1", 4242]]);

  // It lets go. Nothing exited, so nothing is told that anything did.
  await first.service.shutdown({ detach: true });
  assert.deepEqual(first.calls.filter(([kind]) => kind === "exited"), []);
  assert.equal(shell.disposed, 1);

  // Second server: adopts the same shell.
  const second = observedService(heldProcess(0));
  second.service.adoptSession({
    identity: identity("s1"), cwd: "/work", createdAt: 1, cols: 80, rows: 24, process: shell, outputPosition: 0,
  });
  // Registered again, and bound to the same pid: an agent that is a descendant
  // of that shell is still a descendant of this terminal's shell.
  assert.deepEqual(second.calls, [["prepare", "s1"], ["started", "s1", 4242]]);

  // When it really exits, that is announced once, with its code.
  shell.exit(3);
  assert.deepEqual(second.calls.at(-1), ["exited", "s1", 3]);
  assert.equal(second.calls.filter(([kind]) => kind === "exited").length, 1);
});

test("a session restored as ended announces no process and no second exit", () => {
  const { service, calls } = observedService(heldProcess(1));
  service.restoreEndedSession({
    identity: identity("gone"), cwd: "/work", createdAt: 1, cols: 80, rows: 24,
    status: "exited", exitCode: 0, endedAt: 5, outputPosition: 0, bytes: new TextEncoder().encode("bye"),
  });
  // Nothing happened now: it ended while no server was watching.
  assert.deepEqual(calls, []);
  assert.equal(service.getSession("gone").pid, undefined);
});

test("an adopted process with no pid is not announced as started", () => {
  // A held session that had already ended is adopted without its pid, so
  // nothing binds an agent to a number that may now belong to something else.
  const { service, calls } = observedService(heldProcess(1));
  service.adoptSession({
    identity: identity("s2"), cwd: "/work", createdAt: 1, cols: 80, rows: 24, process: heldProcess(undefined), outputPosition: 0,
  });
  assert.deepEqual(calls, [["prepare", "s2"]]);
});

/**
 * Automation runs do not span a server restart. A graceful shutdown stops a
 * run and ends its terminal, as it always has. After a crash the run's shell
 * may still be held and is reattached like any other terminal, but the run
 * itself is over: it is recorded as stopped, never left looking in progress.
 */
test("a run that was in progress when the server stopped is recorded as stopped on the next start", async () => {
  let persisted;
  const backend = { async load() { return persisted; }, async commit(state) { persisted = structuredClone(state); } };
  const before = new AutomationRunLog(backend);
  await before.load();
  await before.record({
    runId: "run-1", automationId: "auto-1", triggerKind: "schedule", firedAt: 10, startedBy: "trigger",
    status: "running", startedAt: 10, sessionId: "run-terminal",
  });
  assert.equal(before.get("run-1").status, "running");

  const after = new AutomationRunLog(backend);
  await after.load();
  const run = after.get("run-1");
  assert.equal(run.status, "finished");
  assert.equal(run.outcome, "stopped");
  assert.match(run.reason, /server stopped during the run/);
});
