import assert from "node:assert/strict";
import test from "node:test";
import { NotificationManager } from "../dist/index.js";

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
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].handler();
      }
      now = target;
    },
  };
}

function managed() {
  const clock = fakeClock(1_000);
  let nextId = 0;
  const manager = new NotificationManager({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `n-${++nextId}`,
  });
  const events = [];
  manager.subscribe((event) => events.push(event));
  return { clock, manager, events };
}

const posts = (count, body = "Build is green", throughSequence = count, raisedAt = 2_000) => ({ count, body, throughSequence, raisedAt });

test("a bot's notification is published after the settle period with its bot identity", () => {
  const { clock, manager, events } = managed();
  manager.setBot("bot-a", posts(1));
  clock.advance(4_999);
  assert.equal(events.length, 0);
  clock.advance(1);
  assert.deepEqual(events.map((e) => [e.type, e.owner, e.botId]), [["notification.published", "bot", "bot-a"]]);
  assert.equal(events[0].projectId, undefined);
  assert.deepEqual({ ...events[0].notification }, {
    id: "n-1", owner: "bot", botId: "bot-a", source: "bot", kind: "bot-message",
    body: "Build is green", count: 1, throughSequence: 1, raisedAt: 2_000,
  });
});

test("a bot's notification withdrawn while pending is never published", () => {
  const { clock, manager, events } = managed();
  manager.setBot("bot-a", posts(1));
  clock.advance(3_000);
  manager.setBot("bot-a", undefined);
  clock.advance(60_000);
  assert.equal(events.length, 0);
  assert.equal(manager.revision, 0);
});

test("an update while pending keeps the original settle deadline and the one record", () => {
  const { clock, manager, events } = managed();
  manager.setBot("bot-a", posts(1));
  clock.advance(3_000);
  manager.setBot("bot-a", posts(2, "Second"));
  clock.advance(2_000);
  assert.deepEqual(events.map((e) => e.type), ["notification.published"]);
  assert.equal(events[0].notification.count, 2);
  assert.equal(Object.keys(manager.snapshot().notifications).length, 1);
});

test("an update while published changes it in place and never withdraws it", () => {
  const { clock, manager, events } = managed();
  manager.setBot("bot-a", posts(1));
  clock.advance(5_000);
  manager.setBot("bot-a", posts(2, "Second", 4, 3_000));
  assert.deepEqual(events.map((e) => [e.type, e.id]), [["notification.published", "n-1"], ["notification.changed", "n-1"]]);
  assert.equal(events[1].notification.body, "Second");
  assert.equal(events[1].notification.throughSequence, 4);
});

test("removing a published bot notification carries its owner on the removal", () => {
  const { clock, manager, events } = managed();
  manager.setBot("bot-a", posts(1));
  clock.advance(5_000);
  manager.setBot("bot-a", undefined);
  const removal = events.at(-1);
  assert.equal(removal.type, "notification.removed");
  assert.equal(removal.owner, "bot");
  assert.equal(removal.botId, "bot-a");
  assert.equal(removal.notification, undefined);
});

test("a bot's excerpt is bounded plain text", () => {
  const { clock, manager } = managed();
  manager.setBot("bot-a", posts(1, `\u001b[31mred\u001b[0m ${"x".repeat(400)}`));
  clock.advance(5_000);
  const [record] = Object.values(manager.snapshot().notifications);
  assert.ok(record.body.startsWith("red x"));
  assert.equal([...record.body].length, 280);
});

test("bot records and events are hidden from a reader without bot authority or with a project claim", () => {
  const { clock, manager } = managed();
  manager.setActivity({ projectId: "project-a", sessionId: "session-a" }, "attention");
  manager.setBot("bot-a", posts(1));
  clock.advance(5_000);
  manager.setBot("bot-a", undefined);
  const owners = (visibility) => Object.values(manager.snapshot(visibility).notifications).map((r) => r.owner);
  const eventOwners = (visibility) => manager.replay(0, visibility).events.map((e) => `${e.type}:${e.owner}`);
  assert.deepEqual(eventOwners({ bots: true }), ["notification.published:terminal", "notification.published:bot", "notification.removed:bot"]);
  assert.deepEqual(eventOwners({ bots: false }), ["notification.published:terminal"]);
  assert.deepEqual(eventOwners({ projectId: "project-a", bots: true }), ["notification.published:terminal"]);
  manager.setBot("bot-b", posts(1));
  clock.advance(5_000);
  assert.deepEqual(owners({ bots: true }).sort(), ["bot", "terminal"]);
  assert.deepEqual(owners({ bots: false }), ["terminal"]);
  assert.deepEqual(owners({ projectId: "project-a", bots: true }), ["terminal"]);
  // Revisions stay global, so a narrowed reader's cursor still lines up.
  assert.equal(manager.snapshot({ bots: false }).revision, manager.revision);
});

test("a bot record is found only by its own bot and never by a terminal owner", () => {
  const { clock, manager } = managed();
  manager.setBot("bot-a", posts(1));
  clock.advance(5_000);
  assert.equal(manager.findBot("n-1", "bot-a")?.botId, "bot-a");
  assert.equal(manager.findBot("n-1", "bot-b"), undefined);
  assert.equal(manager.find("n-1", { projectId: "project-a", sessionId: "session-a" }), undefined);
});

test("an invalid bot state is refused", () => {
  const { manager } = managed();
  assert.throws(() => manager.setBot("bot-a", posts(0)), TypeError);
  assert.throws(() => manager.setBot("", posts(1)), TypeError);
});
