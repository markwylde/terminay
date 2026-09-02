import assert from "node:assert/strict";
import test from "node:test";
import { TerminalActivityService, TerminalActivityServiceError } from "../dist/activity/index.js";

const identity = (projectId = "project-a", sessionId = "session-a") => ({ serverId: "server-a", projectId, sessionId });

function fakeClock(start = 0) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(handler, milliseconds) {
      const id = ++nextId;
      timers.set(id, { at: now + milliseconds, handler });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        due[1].handler();
      }
    },
    get size() { return timers.size; },
  };
}

test("server-owned deadlines publish raw/progress idle transitions and clean up timers", () => {
  const clock = fakeClock(100);
  const service = new TerminalActivityService({
    serverId: "server-a",
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    reducer: { rawActivityMs: 10, progressStaleMs: 20 },
  });
  service.register(identity());
  const events = [];
  service.subscribe((event) => events.push(event));

  // Only a settled session (one the user has typed into) can become unread.
  service.ingestSignal(identity(), { kind: "userInput" });
  clock.advance(2_000);

  service.ingestPtyOutput(identity(), "raw");
  assert.equal(service.get(identity()).status, "working");
  assert.equal(clock.size, 1);
  clock.advance(10);
  assert.equal(service.get(identity()).status, "idle");
  assert.equal(service.get(identity()).acknowledged, false);
  assert.equal(events.at(-1).snapshot.status, "idle");

  service.ingestSignal(identity(), { kind: "progress", state: 3 });
  assert.equal(clock.size, 1);
  clock.advance(20);
  assert.equal(service.get(identity()).status, "idle");
  assert.equal(events.at(-1).snapshot.source, "structured:stale");

  const second = identity("project-a", "session-b");
  service.register(second);
  service.ingestPtyOutput(second, "late raw");
  assert.equal(clock.size, 1);
  service.markExited(second);
  assert.equal(clock.size, 0);
  service.shutdown();
  assert.equal(clock.size, 0);
});

test("activity service parses PTY output before raw fallback and replays one ordered stream", () => {
  let now = 100;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now, reducer: { maxEvents: 16 } });
  service.register(identity());
  const first = service.ingestPtyOutput(identity(), "\u001b]133;C\u001b\\");
  assert.equal(first.length, 1);
  assert.equal(service.get(identity())?.status, "working");
  now = 101;
  const second = service.ingestPtyOutput(identity(), "\u001b]133;D;0\u001b\\");
  assert.ok(second.length >= 1);
  assert.equal(service.get(identity())?.status, "idle");
  assert.equal(service.replay(0).kind, "events");
  assert.ok(service.replay(0).events.every((event, index, events) => index === 0 || event.revision > events[index - 1].revision));
});

test("OSC 9;4 and OSC 133/633 completion markers remain exact canonical session events", () => {
  let now = 1;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now });
  service.register(identity());
  const isolated = service.ingestPtyOutput(identity(), "\u001b]9;4;0\u0007");
  assert.equal(isolated.length, 1);
  assert.deepEqual(service.get(identity()), {
    sessionId: "session-a", projectId: "project-a", foregroundBusy: false, foregroundObservation: "available", status: "idle",
    attention: false, acknowledged: true, claimed: true,
    authority: "structured", source: "structured:progress", updatedAt: 1,
  });
  now = 2;
  service.ingestPtyOutput(identity(), "\u001b]133;C\u0007");
  assert.equal(service.get(identity()).status, "working");
  now = 3;
  service.ingestPtyOutput(identity(), "\u001b]133;D;0\u0007");
  assert.equal(service.get(identity()).status, "idle");
  assert.equal(service.get(identity()).exitCode, 0);
  now = 4;
  service.ingestPtyOutput(identity(), "\u001b]633;C\u001b\\");
  assert.equal(service.get(identity()).status, "working");
  now = 5;
  service.ingestPtyOutput(identity(), "\u001b]633;D;7\u001b\\");
  assert.equal(service.get(identity()).status, "idle");
  assert.equal(service.get(identity()).exitCode, 7);
});

test("raw shell echo before an explicit completion cannot pin a claimed session working", () => {
  let now = 1;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now });
  service.register(identity());
  service.ingestSignal(identity(), { kind: "userInput" });
  now = 1_500;
  service.ingestPtyOutput(identity(), "printf command echo");
  assert.equal(service.get(identity()).status, "working");
  now = 1_502;
  service.ingestPtyOutput(identity(), "\u001b]9;4;0;\u0007");
  assert.equal(service.get(identity()).status, "idle");
  assert.equal(service.get(identity()).claimed, true);
  assert.equal(service.get(identity()).acknowledged, false);
});

test("a delayed shell completion without an executing marker is still unread", () => {
  let now = 1;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now });
  service.register(identity());
  service.ingestSignal(identity(), { kind: "userInput" });
  now = 1_002;
  service.ingestSignal(identity(), { kind: "command", phase: "finished", exitCode: 0 });
  assert.equal(service.get(identity()).acknowledged, false);
  assert.equal(service.get(identity()).exitCode, undefined);
});

test("accepted input becomes unread after the server-owned quiet fallback", () => {
  const clock = fakeClock(100);
  const service = new TerminalActivityService({
    serverId: "server-a",
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  service.register(identity());
  service.ingestSignal(identity(), { kind: "userInput" });
  assert.equal(clock.size, 1);
  clock.advance(1_000);
  service.ingestSignal(identity(), { kind: "userInput" });
  clock.advance(1_999);
  assert.equal(service.get(identity()).acknowledged, true);
  clock.advance(1);
  assert.equal(service.get(identity()).acknowledged, false);
  assert.equal(clock.size, 0);
  service.ingestSignal(identity(), { kind: "userInput" });
  assert.equal(clock.size, 1);
  service.markExited(identity());
  assert.equal(clock.size, 0);
});

test("viewing a terminal consumes pending raw prompt activity", () => {
  const clock = fakeClock(100);
  const service = new TerminalActivityService({
    serverId: "server-a",
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  service.register(identity());
  service.ingestPtyOutput(identity(), "shell prompt");
  service.acknowledge(identity());
  clock.advance(1_000);
  assert.equal(service.get(identity()).acknowledged, true);
  assert.equal(service.get(identity()).status, "idle");
  assert.equal(clock.size, 0);
});

test("viewing acknowledged raw output preserves the genuine input quiet completion", () => {
  const clock = fakeClock(100);
  const service = new TerminalActivityService({
    serverId: "server-a",
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  service.register(identity());
  service.ingestSignal(identity(), { kind: "userInput" });
  clock.advance(100);
  service.ingestPtyOutput(identity(), "command echo");
  assert.equal(service.get(identity()).acknowledged, true);
  service.acknowledge(identity());
  clock.advance(1_000);
  assert.equal(service.get(identity()).acknowledged, true);
  clock.advance(900);
  assert.equal(service.get(identity()).acknowledged, false);
  assert.equal(service.get(identity()).source, "structured:input-quiet");
});

test("activity service rejects cross-server/project and stale session writes", () => {
  const service = new TerminalActivityService({ serverId: "server-a" });
  service.register(identity());
  assert.throws(() => service.ingestSignal({ ...identity(), serverId: "server-b" }, { kind: "bell" }), (error) => error instanceof TerminalActivityServiceError && error.code === "server_mismatch");
  assert.throws(() => service.ingestSignal(identity("project-b"), { kind: "bell" }), (error) => error instanceof TerminalActivityServiceError && error.code === "project_mismatch");
  service.markExited(identity());
  assert.throws(() => service.ingestPtyOutput(identity(), "late"), (error) => error instanceof TerminalActivityServiceError && error.code === "session_exited");
});

test("provider activity remains authoritative over later PTY fallback evidence", () => {
  const service = new TerminalActivityService({ serverId: "server-a" });
  service.register(identity());
  service.ingestProvider(identity(), { provider: "codex", state: "waiting", agentId: "agent-a", sequence: 1 });
  service.ingestPtyOutput(identity(), "spinner");
  assert.equal(service.get(identity())?.provider, "codex");
  assert.equal(service.get(identity())?.providerState, "waiting");
});

test("acknowledgement preserves provider working, waiting, and blocked state", () => {
  const service = new TerminalActivityService({ serverId: "server-a" });
  for (const [index, state] of ["working", "waiting", "blocked"].entries()) {
    const target = identity("project-a", `provider-${state}`);
    service.register(target);
    service.ingestProvider(target, {
      provider: "codex",
      state,
      agentId: `agent-${index}`,
      sequence: 1,
    });
    service.acknowledge(target);
    const snapshot = service.get(target);
    assert.equal(snapshot.providerState, state);
    assert.equal(snapshot.authority, "provider");
    assert.equal(snapshot.status, state === "working" ? "working" : "idle");
    assert.equal(snapshot.acknowledged, true);
  }
});

test("multiple subscribers receive one ordered canonical stream and scoped acknowledgement", () => {
  const service = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  service.register(identity());
  const first = [];
  const second = [];
  service.subscribe((event, snapshot) => first.push({ event, snapshot }));
  service.subscribe((event, snapshot) => second.push({ event, snapshot }));

  service.ingestSignal(identity(), { kind: "bell" });
  service.acknowledge(identity());

  assert.equal(first.length, 2);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(({ event }) => event.revision), [1, 2]);
  assert.equal(first[0].event.snapshot.sessionId, "session-a");
  assert.equal(first[1].snapshot.sessions["session-a"].acknowledged, true);
  assert.equal(first[1].snapshot.sessions["session-a"].attention, false);
});
