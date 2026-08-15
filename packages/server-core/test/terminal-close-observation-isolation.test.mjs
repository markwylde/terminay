import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_OPERATIONS,
  OrderedEventJournal,
  TerminalActivityService,
  TerminalService,
  composeActivityLifecycle,
  createActivityOperationRegistry,
  createNodePtyFactory,
} from "../dist/index.js";

function createChild(pid) {
  const data = new Set();
  const exits = new Set();
  return {
    pid,
    process: "zsh",
    write() {},
    resize() {},
    kill() {},
    onData(listener) { data.add(listener); return { dispose: () => data.delete(listener) }; },
    onExit(listener) { exits.add(listener); return { dispose: () => exits.delete(listener) }; },
    emitData(value) { for (const listener of [...data]) listener(value); },
  };
}

function createScheduler() {
  const active = new Map();
  let nextId = 0;
  return {
    setInterval(callback, delayMs) {
      const id = ++nextId;
      active.set(id, { callback, delayMs });
      return id;
    },
    clearInterval(id) { active.delete(id); },
  };
}

test("slow foreground observation cannot delay a snapshot or an unrelated terminal close", async () => {
  const children = new Map();
  const resolvers = new Map();
  let noisyCalls = 0;
  const factory = createNodePtyFactory(
    {
      spawn(_file, _args, options) {
        const child = createChild(options.name === "noisy" ? 501 : 500);
        children.set(options.name, child);
        return child;
      },
    },
    {
      foregroundPolling: createScheduler(),
      resolveForegroundProcess: (pid) => {
        if (pid === 501) {
          noisyCalls += 1;
          return new Promise((resolve) => {
            resolvers.set(pid, resolve);
          });
        }
        return Promise.resolve("zsh");
      },
    },
  );
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const terminal = new TerminalService({
    serverId: "server-a",
    ptyFactory: factory,
    sessionLifecycle: composeActivityLifecycle(activity, undefined, undefined),
  });
  const idle = await terminal.createSession({
    projectId: "project-a",
    sessionId: "idle",
    shellPath: "/bin/zsh",
    name: "idle",
    cols: 80,
    rows: 24,
  });
  const noisy = await terminal.createSession({
    projectId: "project-a",
    sessionId: "noisy",
    shellPath: "/bin/zsh",
    name: "noisy",
    cols: 80,
    rows: 24,
  });
  const registry = createActivityOperationRegistry({
    service: activity,
    eventJournal: new OrderedEventJournal(),
    observeForeground: async (_request, scope) => {
      if (scope.sessionId !== undefined) {
        return [await terminal.observeForegroundProcess(
          { serverId: "server-a", projectId: scope.projectId, sessionId: scope.sessionId },
          undefined,
          30,
        )];
      }
      return [...await terminal.observeProjectForegroundProcesses(scope.projectId, undefined, 30)];
    },
  });
  const context = Object.freeze({
    connectionId: "connection-a",
    clientId: "client-a",
    authScope: "admin",
    signal: new AbortController().signal,
  });
  const query = (operation, payload) => ({ envelope: { operation, payload }, body: new Uint8Array(), context });

  try {
    children.get("noisy").emitData("codex-output\n");
    children.get("noisy").emitData("codex-output\n");
    children.get("noisy").emitData("codex-output\n");
    assert.ok(noisyCalls >= 1);

    const snapshotStarted = Date.now();
    const snapshot = registry.operations.queries[ACTIVITY_OPERATIONS.snapshot](query(ACTIVITY_OPERATIONS.snapshot, {}));
    assert.ok(Date.now() - snapshotStarted < 50);
    assert.equal(snapshot.sessions[idle.sessionId].foregroundBusy, false);

    const closeStarted = Date.now();
    const preflight = await registry.operations.queries[ACTIVITY_OPERATIONS.closePreflight](query(ACTIVITY_OPERATIONS.closePreflight, {
      projectId: "project-a",
      sessionId: idle.sessionId,
    }));
    assert.ok(Date.now() - closeStarted < 200, "closing an idle terminal must not await a noisy sibling");
    assert.equal(preflight.observation, "available");
    assert.deepEqual(preflight.runningSessionIds, []);
    assert.equal(preflight.sessions[0].sessionId, idle.sessionId);

    const busy = await registry.operations.queries[ACTIVITY_OPERATIONS.closePreflight](query(ACTIVITY_OPERATIONS.closePreflight, {
      projectId: "project-a",
      sessionId: noisy.sessionId,
    }));
    assert.equal(busy.observation, "limited");
    assert.equal(busy.sessions[0].observation, "limited");
    assert.equal(activity.get({ serverId: "server-a", projectId: "project-a", sessionId: noisy.sessionId }).foregroundObservation, "limited");

    const project = await registry.operations.queries[ACTIVITY_OPERATIONS.closePreflight](query(ACTIVITY_OPERATIONS.closePreflight, {
      projectId: "project-a",
    }));
    assert.deepEqual(project.sessions.map((session) => session.sessionId).sort(), ["idle", "noisy"]);
    assert.equal(project.observation, "limited");
  } finally {
    registry.close();
    await terminal.shutdown();
    activity.shutdown();
  }
});
