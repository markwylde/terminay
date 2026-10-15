import assert from "node:assert/strict";
import test from "node:test";
import {
  activityNotificationKind,
  bindNotificationsToActivity,
  NotificationManager,
  NotificationManagerError,
  plainText,
  TerminalActivityService,
} from "../dist/index.js";

const SERVER = "server-a";
const owner = (sessionId = "session-a", projectId = "project-a") => ({ projectId, sessionId });
const identity = (sessionId = "session-a", projectId = "project-a") => ({ serverId: SERVER, projectId, sessionId });

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
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].handler();
      }
      now = target;
    },
    get size() { return timers.size; },
  };
}

function managed(options = {}) {
  const clock = fakeClock(1_000);
  let nextId = 0;
  const manager = new NotificationManager({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `n-${++nextId}`,
    ...options,
  });
  const events = [];
  manager.subscribe((event) => events.push(event));
  return { clock, manager, events };
}

const published = (manager) => Object.values(manager.snapshot().notifications);

test("an added notification is pending and no consumer can see it", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "agent-finished");
  assert.equal(manager.pendingCount, 1);
  assert.deepEqual(published(manager), []);
  assert.equal(manager.revision, 0);
  assert.deepEqual(manager.replay(0).events, []);
  assert.equal(events.length, 0);
  clock.advance(4_999);
  assert.deepEqual(published(manager), []);
});

test("a notification still present after five seconds is published", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "agent-finished");
  clock.advance(5_000);
  assert.equal(manager.pendingCount, 0);
  assert.deepEqual(events.map((event) => event.type), ["notification.published"]);
  const [record] = published(manager);
  assert.deepEqual(
    { ...record },
    { id: "n-1", projectId: "project-a", sessionId: "session-a", source: "activity", kind: "agent-finished", raisedAt: 1_000 },
  );
});

test("a notification removed at three seconds is never published and publishes no removal", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "agent-finished");
  clock.advance(3_000);
  manager.setActivity(owner(), undefined);
  clock.advance(60_000);
  assert.equal(events.length, 0);
  assert.equal(manager.revision, 0);
  assert.deepEqual(published(manager), []);
});

test("removing a published notification is published at once", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "agent-finished");
  clock.advance(5_000);
  manager.setActivity(owner(), undefined);
  assert.deepEqual(events.map((event) => event.type), ["notification.published", "notification.removed"]);
  assert.equal(events[1].id, "n-1");
  assert.equal(events[1].projectId, "project-a");
  assert.equal(events[1].notification, undefined);
  assert.deepEqual(published(manager), []);
});

test("a change at three seconds is published at five with the current kind", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "agent-waiting");
  clock.advance(3_000);
  manager.setActivity(owner(), "agent-finished");
  assert.equal(events.length, 0);
  clock.advance(1_999);
  assert.equal(events.length, 0);
  clock.advance(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].notification.kind, "agent-finished");
  assert.equal(events[0].notification.id, "n-1");
});

test("a change after publication is published at once and keeps the record", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "agent-waiting");
  clock.advance(5_000);
  manager.setActivity(owner(), "agent-finished");
  assert.deepEqual(events.map((event) => event.type), ["notification.published", "notification.changed"]);
  assert.equal(events[1].id, events[0].id);
  assert.equal(published(manager).length, 1);
  assert.equal(published(manager)[0].kind, "agent-finished");
});

test("exactly one timer is armed per pending record and none while nothing is pending", () => {
  const { clock, manager } = managed();
  assert.equal(clock.size, 0);
  manager.setActivity(owner("session-a"), "attention");
  manager.setActivity(owner("session-b"), "command-finished");
  manager.send(owner("session-a"), { body: "hello" });
  assert.equal(clock.size, 3);
  assert.equal(manager.pendingCount, 3);
  // Setting the same kind again arms nothing.
  manager.setActivity(owner("session-a"), "attention");
  assert.equal(clock.size, 3);
  manager.setActivity(owner("session-b"), undefined);
  assert.equal(clock.size, 2);
  clock.advance(5_000);
  assert.equal(clock.size, 0);
  assert.equal(manager.pendingCount, 0);
  manager.removeSession("session-a");
  assert.equal(clock.size, 0);
});

test("a sent notification carries bounded plain text and its server-resolved owner", () => {
  const { clock, manager } = managed();
  const record = manager.send(owner(), {
    title: "  Review\u001b[31m ready\u001b[0m ",
    body: "<b>Three</b>\nfiles \u001b]0;evil\u0007changed\u0000",
  });
  assert.equal(record.source, "message");
  assert.equal(record.kind, "message");
  assert.equal(record.title, "Review ready");
  assert.equal(record.body, "<b>Three</b> files changed");
  assert.equal(record.sessionId, "session-a");
  assert.equal(record.projectId, "project-a");
  clock.advance(5_000);
  assert.equal(published(manager)[0].body, "<b>Three</b> files changed");
});

test("plain text removes escape sequences and control characters", () => {
  assert.equal(plainText("a\u001b[1mb\u001b[0m"), "ab");
  assert.equal(plainText("\u001b]8;;https://example.test\u001b\\link\u001b]8;;\u001b\\"), "link");
  assert.equal(plainText("one\ttwo\r\nthree"), "one two three");
  assert.equal(plainText("\u0007bell\u009b"), "bell");
});

test("over-long or empty text is refused and adds nothing", () => {
  const { manager } = managed();
  assert.throws(() => manager.send(owner(), { body: "x".repeat(281) }), (error) => error instanceof NotificationManagerError && error.code === "invalid");
  assert.throws(() => manager.send(owner(), { title: "t".repeat(81), body: "ok" }), (error) => error.code === "invalid");
  assert.throws(() => manager.send(owner(), { body: "\u001b[0m" }), (error) => error.code === "invalid");
  assert.equal(manager.pendingCount, 0);
  assert.doesNotThrow(() => manager.send(owner(), { title: "t".repeat(80), body: "x".repeat(280) }));
});

test("sending with a handle replaces in place and keeps the id and publication state", () => {
  const { clock, manager, events } = managed();
  const first = manager.send(owner(), { title: "One", body: "first" });
  const replacedWhilePending = manager.send(owner(), { body: "second" }, first.id);
  assert.equal(replacedWhilePending.id, first.id);
  assert.equal(replacedWhilePending.title, undefined);
  assert.equal(manager.pendingCount, 1);
  assert.equal(events.length, 0);
  clock.advance(5_000);
  assert.equal(events[0].notification.body, "second");
  manager.send(owner(), { title: "Three", body: "third" }, first.id);
  assert.deepEqual(events.map((event) => event.type), ["notification.published", "notification.changed"]);
  assert.equal(published(manager).length, 1);
  assert.equal(published(manager)[0].title, "Three");
});

test("a terminal can dismiss only what it sent", () => {
  const { manager } = managed();
  const sent = manager.send(owner("session-a"), { body: "mine" });
  manager.setActivity(owner("session-a"), "agent-finished");
  const activityId = [...Array(3).keys()].map((n) => `n-${n + 1}`).find((id) => id !== sent.id && manager.find(id, owner("session-a")) !== undefined);
  assert.ok(activityId);
  assert.equal(manager.dismissSent("session-b", sent.id), false, "another terminal's handle is not found");
  assert.equal(manager.dismissSent("session-a", activityId), false, "the activity notification is not found");
  assert.throws(() => manager.send(owner("session-b"), { body: "theirs" }, sent.id), (error) => error.code === "not_found");
  assert.equal(manager.dismissSent("session-a", sent.id), true);
  assert.equal(manager.dismissSent("session-a", sent.id), false);
  assert.equal(manager.pendingCount, 1);
});

test("a terminal holds at most eight sent notifications", () => {
  const { manager } = managed();
  const handles = [];
  for (let index = 0; index < 8; index += 1) handles.push(manager.send(owner(), { body: `n${index}` }).id);
  assert.throws(() => manager.send(owner(), { body: "ninth" }), (error) => error.code === "limit");
  assert.equal(manager.pendingCount, 8);
  for (const handle of handles) assert.ok(manager.find(handle, owner()));
  // Another terminal has its own allowance.
  assert.doesNotThrow(() => manager.send(owner("session-b"), { body: "other" }));
});

test("sends are rate-limited per terminal", () => {
  const { clock, manager } = managed({ sendRateLimit: 3, sendRateWindowMs: 1_000 });
  const first = manager.send(owner(), { body: "1" });
  manager.send(owner(), { body: "2" }, first.id);
  manager.send(owner(), { body: "3" }, first.id);
  assert.throws(() => manager.send(owner(), { body: "4" }, first.id), (error) => error.code === "rate_limited");
  assert.doesNotThrow(() => manager.send(owner("session-b"), { body: "other terminal" }));
  clock.advance(1_000);
  assert.doesNotThrow(() => manager.send(owner(), { body: "4" }, first.id));
});

test("removing what was sent leaves the activity notification, and closing removes both", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "agent-finished");
  manager.send(owner(), { body: "sent" });
  clock.advance(5_000);
  manager.removeSent("session-a");
  assert.deepEqual(published(manager).map((record) => record.source), ["activity"]);
  manager.send(owner(), { body: "again" });
  manager.removeSession("session-a");
  assert.deepEqual(published(manager), []);
  assert.equal(manager.pendingCount, 0);
  assert.equal(clock.size, 0);
  assert.equal(events.at(-1).type, "notification.removed");
});

test("a snapshot and a replay can be scoped to one project", () => {
  const { clock, manager } = managed();
  manager.setActivity(owner("session-a", "project-a"), "attention");
  manager.setActivity(owner("session-b", "project-b"), "attention");
  clock.advance(5_000);
  assert.equal(Object.keys(manager.snapshot().notifications).length, 2);
  assert.deepEqual(Object.values(manager.snapshot("project-b").notifications).map((record) => record.sessionId), ["session-b"]);
  assert.deepEqual(manager.replay(0, "project-a").events.map((event) => event.sessionId), ["session-a"]);
});

test("a replay older than the retained events is a resync with the published snapshot", () => {
  const { clock, manager } = managed({ maxEvents: 2 });
  for (const session of ["s1", "s2", "s3"]) manager.setActivity(owner(session), "attention");
  clock.advance(5_000);
  const replay = manager.replay(0);
  assert.equal(replay.kind, "resync");
  assert.equal(Object.keys(replay.snapshot.notifications).length, 3);
  assert.equal(manager.replay(1).kind, "events");
  assert.throws(() => manager.replay(99), RangeError);
});

test("a terminal moved to another project takes its notifications with it", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner("session-a", "project-a"), "attention");
  clock.advance(5_000);
  manager.rehomeSession("session-a", "project-b");
  assert.deepEqual(events.map((event) => [event.type, event.projectId]), [
    ["notification.published", "project-a"],
    ["notification.removed", "project-a"],
    ["notification.published", "project-b"],
  ]);
  assert.equal(published(manager)[0].projectId, "project-b");
});

test("shutdown disarms every pending timer", () => {
  const { clock, manager, events } = managed();
  manager.setActivity(owner(), "attention");
  manager.shutdown();
  assert.equal(clock.size, 0);
  clock.advance(10_000);
  assert.equal(events.length, 0);
});

// --- fed from terminal activity -------------------------------------------

function fed() {
  const clock = fakeClock(10_000);
  const activity = new TerminalActivityService({
    serverId: SERVER,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const manager = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const unbind = bindNotificationsToActivity(manager, activity);
  activity.register(identity());
  return { clock, activity, manager, unbind };
}

const kinds = (manager) => published(manager).map((record) => record.kind);
const agent = (state, sequence) => ({ provider: "example/agent", state, sequence, agentId: "run-1" });

test("each kind of terminal activity yields its one notification", () => {
  for (const [state, kind] of [["waiting", "agent-waiting"], ["blocked", "agent-blocked"], ["done", "agent-finished"]]) {
    const { clock, activity, manager } = fed();
    activity.ingestProvider(identity(), agent("working", 1));
    assert.equal(manager.pendingCount, 0, "a working agent calls for no notification");
    activity.ingestProvider(identity(), agent(state, 2));
    assert.equal(manager.pendingCount, 1);
    clock.advance(5_000);
    assert.deepEqual(kinds(manager), [kind]);
  }

  const bell = fed();
  bell.activity.ingestSignal(identity(), { kind: "bell" });
  bell.clock.advance(5_000);
  assert.deepEqual(kinds(bell.manager), ["attention"]);

  const command = fed();
  command.activity.ingestSignal(identity(), { kind: "userInput" });
  command.clock.advance(3_000);
  command.activity.ingestSignal(identity(), { kind: "command", phase: "executing" });
  assert.equal(command.manager.pendingCount, 0, "a running command calls for no notification");
  command.activity.ingestSignal(identity(), { kind: "command", phase: "finished", exitCode: 0 });
  command.clock.advance(5_000);
  assert.deepEqual(kinds(command.manager), ["command-finished"]);
});

test("waiting becoming finished updates the same record", () => {
  const { clock, activity, manager } = fed();
  const events = [];
  manager.subscribe((event) => events.push(event));
  activity.ingestProvider(identity(), agent("waiting", 1));
  clock.advance(5_000);
  activity.ingestProvider(identity(), agent("done", 2));
  assert.deepEqual(events.map((event) => event.type), ["notification.published", "notification.changed"]);
  assert.equal(events[0].id, events[1].id);
  assert.deepEqual(kinds(manager), ["agent-finished"]);
});

test("acknowledgement within the settle period means nothing is ever published", () => {
  const { clock, activity, manager } = fed();
  const events = [];
  manager.subscribe((event) => events.push(event));
  activity.ingestProvider(identity(), agent("done", 1));
  clock.advance(3_000);
  activity.acknowledge(identity());
  clock.advance(60_000);
  assert.equal(events.length, 0);
});

test("typing, acknowledgement, and close remove a terminal's notifications", () => {
  for (const interact of [
    (activity) => activity.ingestSignal(identity(), { kind: "userInput" }),
    (activity) => activity.acknowledge(identity()),
    (activity) => activity.markExited(identity()),
  ]) {
    const { clock, activity, manager } = fed();
    activity.ingestSignal(identity(), { kind: "bell" });
    manager.send(owner(), { body: "sent" });
    clock.advance(5_000);
    assert.equal(published(manager).length, 2);
    interact(activity);
    assert.deepEqual(published(manager), []);
    assert.equal(manager.pendingCount, 0);
  }
});

test("interaction removes a sent notification from an agent's terminal even when activity had nothing to clear", () => {
  const { clock, activity, manager } = fed();
  activity.ingestProvider(identity(), agent("working", 1));
  activity.acknowledge(identity());
  manager.send(owner(), { body: "look at this" });
  clock.advance(5_000);
  assert.equal(published(manager).length, 1);
  // The reducer is already acknowledged, so this publishes no activity event.
  activity.acknowledge(identity());
  assert.deepEqual(published(manager), []);
});

test("one terminal's interaction leaves another terminal's notifications alone", () => {
  const { clock, activity, manager } = fed();
  activity.register(identity("session-b"));
  manager.send(owner("session-a"), { body: "a" });
  manager.send(owner("session-b"), { body: "b" });
  clock.advance(5_000);
  activity.acknowledge(identity("session-a"));
  assert.deepEqual(published(manager).map((record) => record.sessionId), ["session-b"]);
});

test("an OSC notification's message never becomes notification text", () => {
  const { clock, activity, manager } = fed();
  activity.ingestPtyOutput(identity(), "\u001b]9;deploy finished\u0007");
  clock.advance(5_000);
  const [record] = published(manager);
  assert.equal(record.kind, "attention");
  assert.equal(record.title, undefined);
  assert.equal(record.body, undefined);

  const second = fed();
  second.activity.ingestPtyOutput(identity(), "\u001b]777;notify;Title;Body\u0007");
  second.clock.advance(5_000);
  assert.deepEqual(Object.keys(published(second.manager)[0]).sort(), ["id", "kind", "projectId", "raisedAt", "sessionId", "source"]);
});

test("activity present before the manager is bound is re-established and settles again", () => {
  const clock = fakeClock(0);
  const activity = new TerminalActivityService({ serverId: SERVER, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  activity.register(identity());
  activity.ingestProvider(identity(), agent("done", 1));

  // A restarted server begins with a fresh manager over the restored activity.
  const manager = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  bindNotificationsToActivity(manager, activity);
  assert.equal(manager.pendingCount, 1);
  assert.deepEqual(published(manager), [], "nothing a process sent, and nothing published, survives");
  clock.advance(4_999);
  assert.deepEqual(published(manager), []);
  clock.advance(1);
  assert.deepEqual(kinds(manager), ["agent-finished"]);
});

test("the kind rule reads only reduced activity state", () => {
  const base = { sessionId: "s", projectId: "p", foregroundBusy: false, foregroundObservation: "available", claimed: false, authority: "structured", source: "t", updatedAt: 1 };
  assert.equal(activityNotificationKind({ ...base, status: "idle", attention: false, acknowledged: true }), undefined);
  assert.equal(activityNotificationKind({ ...base, status: "working", attention: false, acknowledged: false }), undefined);
  assert.equal(activityNotificationKind({ ...base, status: "idle", attention: false, acknowledged: false }), "command-finished");
  assert.equal(activityNotificationKind({ ...base, status: "working", attention: true, acknowledged: false }), "attention");
  assert.equal(activityNotificationKind({ ...base, status: "idle", attention: true, acknowledged: true }), undefined);
  assert.equal(activityNotificationKind({ ...base, status: "idle", attention: false, acknowledged: false, provider: "x/y", providerState: "idle" }), undefined);
  assert.equal(activityNotificationKind({ ...base, status: "idle", attention: true, acknowledged: true, provider: "x/y", providerState: "waiting" }), undefined);
});

// --- untracked terminals (ADR-0065) ---------------------------------------

function tracked(initiallyUntracked = []) {
  const clock = fakeClock(10_000);
  const activity = new TerminalActivityService({ serverId: SERVER, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const manager = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  let untracked = new Set(initiallyUntracked);
  const listeners = new Set();
  const acknowledged = [];
  bindNotificationsToActivity(manager, activity, {
    untrackedSessionIds: () => untracked,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    acknowledge(id) { acknowledged.push(id.sessionId); activity.acknowledge(id, undefined, { passive: true }); },
  });
  activity.register(identity());
  const setUntracked = (ids) => { untracked = new Set(ids); for (const listener of listeners) listener(); };
  return { clock, activity, manager, setUntracked, acknowledged };
}

test("an untracked terminal's activity raises no notification, agent state included", () => {
  const { clock, activity, manager } = tracked(["session-a"]);
  activity.ingestSignal(identity(), { kind: "bell" });
  activity.ingestProvider(identity(), agent("blocked", 1));
  assert.equal(manager.pendingCount, 0);
  clock.advance(10_000);
  assert.deepEqual(published(manager), []);
});

test("turning tracking off withdraws the terminal's activity record and keeps what was sent", () => {
  const { clock, activity, manager, setUntracked } = tracked();
  activity.ingestProvider(identity(), agent("done", 1));
  manager.send(owner(), { body: "deploy finished" });
  clock.advance(5_000);
  assert.deepEqual(kinds(manager).sort(), ["agent-finished", "message"]);
  setUntracked(["session-a"]);
  assert.deepEqual(kinds(manager), ["message"]);
});

test("turning tracking back on acknowledges what happened while untracked", () => {
  const { clock, activity, manager, setUntracked, acknowledged } = tracked(["session-a"]);
  activity.ingestProvider(identity(), agent("done", 1));
  clock.advance(5_000);
  setUntracked([]);
  assert.deepEqual(acknowledged, ["session-a"]);
  clock.advance(10_000);
  assert.deepEqual(published(manager), [], "the earlier finish is not replayed");
  // What happens after tracking resumes is reported as usual.
  activity.ingestProvider(identity(), agent("working", 2));
  activity.ingestProvider(identity(), agent("waiting", 3));
  clock.advance(5_000);
  assert.deepEqual(kinds(manager), ["agent-waiting"]);
});

test("a process may still send a notification from an untracked terminal", () => {
  const { clock, manager } = tracked(["session-a"]);
  manager.send(owner(), { body: "needs you" });
  clock.advance(5_000);
  assert.deepEqual(kinds(manager), ["message"]);
});
