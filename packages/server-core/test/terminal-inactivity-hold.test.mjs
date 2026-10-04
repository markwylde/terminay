import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentStatusService,
  TerminalActivityService,
  TerminalService,
  createAgentInactivityHold,
  createServerCoreComposition,
  workingAgentTerminals,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 7000 + processes.length,
        options,
        write() {},
        resize() {},
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) {
          const bytes = new TextEncoder().encode(value);
          for (const listener of dataListeners) listener(bytes);
        },
        emitExit(exit) {
          for (const listener of exitListeners) listener(exit);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

function createInactivityTimer() {
  let now = 0;
  let nextId = 0;
  const scheduled = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      scheduled.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(id) { scheduled.delete(id); },
    advanceBy(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...scheduled.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (next === undefined) break;
        const [id, timer] = next;
        scheduled.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
    get size() { return scheduled.size; },
  };
}

/** A hold source a test flips by hand. */
function createHold() {
  const held = new Set();
  const listeners = new Set();
  return {
    listeners,
    isHeld: (identity) => held.has(identity.sessionId),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(sessionId, value) {
      if (value) held.add(sessionId); else held.delete(sessionId);
      for (const listener of listeners) listener(sessionId);
    },
  };
}

async function fixture(hold) {
  const pty = createPtyFactory();
  const timer = createInactivityTimer();
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    inactivityTimer: timer,
    ...(hold === undefined ? {} : { inactivityHold: hold }),
  });
  const handle = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  return { pty, timer, service, handle, process: pty.processes[0] };
}

function track(promise) {
  const state = { resolved: false };
  state.done = promise.then(() => { state.resolved = true; });
  return state;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const entry = (overrides = {}) => ({
  entryId: "e1",
  kind: "root",
  provider: "com.example/agents",
  harness: "claude-code",
  agentId: "s1",
  sessionId: "s1",
  activationTerminalSessionId: "session-a",
  external: false,
  projectIds: ["project-a"],
  state: "working",
  stateStartedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  active: true,
  activeTools: [],
  unread: false,
  terminalSessionId: "session-a",
  inProcess: false,
  openSubagents: 0,
  ...overrides,
});

test("a held inactivity wait stays open through a quiet period and release restarts the full period", async () => {
  const hold = createHold();
  const { timer, handle, service } = await fixture(hold);
  hold.set("session-a", true);

  const wait = track(handle.waitForInactivity(100));
  timer.advanceBy(1_000);
  await settle();
  assert.equal(wait.resolved, false, "a working agent that prints nothing holds the wait");
  assert.equal(timer.size, 0, "a held waiter keeps no timer running");

  hold.set("session-a", false);
  timer.advanceBy(99);
  await settle();
  assert.equal(wait.resolved, false, "release starts the quiet period again");
  timer.advanceBy(1);
  await wait.done;
  assert.equal(wait.resolved, true);
  await service.shutdown();
});

test("output during a hold and after release restarts the quiet period", async () => {
  const hold = createHold();
  const { timer, handle, process, service } = await fixture(hold);
  hold.set("session-a", true);

  const wait = track(handle.waitForInactivity(100));
  timer.advanceBy(100);
  process.emitData("still working");
  timer.advanceBy(100);
  await settle();
  assert.equal(wait.resolved, false);

  hold.set("session-a", false);
  timer.advanceBy(50);
  process.emitData("final redraw");
  timer.advanceBy(99);
  await settle();
  assert.equal(wait.resolved, false, "the period is measured from the later of release and last output");
  timer.advanceBy(1);
  await wait.done;
  await service.shutdown();
});

test("a hold on another session does not affect a quiet terminal", async () => {
  const hold = createHold();
  const { timer, handle, service } = await fixture(hold);
  await service.createSession({ projectId: "project-a", sessionId: "session-b", cols: 80, rows: 24 });
  hold.set("session-b", true);

  const wait = track(handle.waitForInactivity(100));
  timer.advanceBy(100);
  await wait.done;
  assert.equal(wait.resolved, true);
  await service.shutdown();
});

test("a held wait can be cancelled and resolves when its terminal exits", async () => {
  const hold = createHold();
  const { timer, handle, process, service } = await fixture(hold);
  hold.set("session-a", true);

  const controller = new AbortController();
  const cancelled = handle.waitForInactivity(100, { signal: controller.signal });
  const exited = track(handle.waitForInactivity(100));
  timer.advanceBy(100);
  const reason = new DOMException("cancelled", "AbortError");
  controller.abort(reason);
  await assert.rejects(cancelled, (error) => error === reason);
  assert.equal(exited.resolved, false, "cancelling one wait leaves the other held");

  process.emitExit({ exitCode: 0, signal: null });
  await exited.done;
  assert.equal(exited.resolved, true);
  await service.shutdown();
});

test("a faulty hold source falls back to output-only inactivity and shutdown unsubscribes", async () => {
  const listeners = new Set();
  const { timer, handle, process, service } = await fixture({
    isHeld() { throw new Error("hold source fault"); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  assert.equal(listeners.size, 1);

  const wait = track(handle.waitForInactivity(100));
  timer.advanceBy(50);
  process.emitData("output is still accepted");
  assert.equal(handle.snapshot().status, "running");
  timer.advanceBy(100);
  await wait.done;
  assert.equal(wait.resolved, true);

  await service.shutdown();
  assert.equal(listeners.size, 0);
});

test("only a live working root holds its own terminal", () => {
  const sessions = (entries) => [...workingAgentTerminals({
    entries: Object.fromEntries(entries.map((value) => [value.entryId, value])),
  })];

  assert.deepEqual(sessions([entry()]), ["session-a"]);
  for (const state of ["waiting", "blocked", "done", "idle"])
    assert.deepEqual(sessions([entry({ state })]), [], `${state} does not hold a wait`);
  assert.deepEqual(sessions([entry({ active: false })]), [], "an inactive entry does not hold a wait");
  assert.deepEqual(
    sessions([entry({ entryId: "child", kind: "subagent", terminalSessionId: null, activationTerminalSessionId: null })]),
    [],
    "a subagent holds only through its root",
  );
  assert.deepEqual(
    sessions([entry({ terminalSessionId: null, activationTerminalSessionId: null, external: true })]),
    [],
    "an unbound agent holds no terminal",
  );
  assert.deepEqual(
    sessions([entry({ state: "done" }), entry({ entryId: "e2", terminalSessionId: "session-b", activationTerminalSessionId: "session-b" })]),
    ["session-b"],
  );
});

test("the agent hold reports a terminal only when its working answer changes", async () => {
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, now: () => 1_000 });
  await agents.start();
  agents.register(identity);
  const hold = createAgentInactivityHold(agents);
  const changes = [];
  const unsubscribe = hold.subscribe((sessionId) => changes.push(sessionId));

  assert.equal(hold.isHeld(identity), false);
  agents.applyEntries([entry()]);
  assert.equal(hold.isHeld(identity), true);
  assert.equal(hold.isHeld({ ...identity, sessionId: "session-b" }), false);
  agents.applyEntries([entry({ updatedAt: 2, activeTools: [] , stateStartedAt: 1 })]);
  agents.applyEntries([entry({ state: "waiting", updatedAt: 3 })]);
  assert.equal(hold.isHeld(identity), false);
  agents.applyEntries([entry({ state: "done", updatedAt: 4 })]);
  assert.deepEqual(changes, ["session-a", "session-a"], "held and released, once each");

  unsubscribe();
  agents.applyEntries([entry({ updatedAt: 5 })]);
  assert.equal(changes.length, 2);
  await agents.stop();
});

test("composition holds a quiet terminal's wait while its agent works and releases it when the turn ends", async () => {
  const pty = createPtyFactory();
  const timer = createInactivityTimer();
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const agents = new AgentStatusService({ activity });
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "server-a",
    serverVersion: "1.0.0",
    capabilities: ["agents"],
    ptyFactory: pty,
    activity,
    agents,
    terminalOptions: { inactivityTimer: timer },
  });
  await composition.start();
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: "session-b", cols: 80, rows: 24 });
  agents.applyEntries([entry()]);

  const held = track(composition.terminal.waitForInactivity(identity, 3_000));
  const other = track(composition.terminal.waitForInactivity({ ...identity, sessionId: "session-b" }, 3_000));
  timer.advanceBy(10_000);
  await other.done;
  await settle();
  assert.equal(held.resolved, false, "a silent working agent keeps its terminal busy");
  assert.equal(other.resolved, true, "an agent in another terminal does not");

  agents.applyEntries([entry({ state: "done", updatedAt: 2 })]);
  timer.advanceBy(2_999);
  await settle();
  assert.equal(held.resolved, false);
  timer.advanceBy(1);
  await held.done;
  assert.equal(held.resolved, true);

  agents.applyEntries([entry({ state: "waiting", updatedAt: 3 })]);
  const approval = track(composition.terminal.waitForInactivity(identity, 3_000));
  timer.advanceBy(3_000);
  await approval.done;
  assert.equal(approval.resolved, true, "an agent waiting for approval does not hold the wait");

  await composition.shutdown();
});
