import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotificationEventProjector,
  createNotificationOperationRegistry,
  NOTIFICATION_OPERATIONS as OP,
  NotificationManager,
} from "../dist/index.js";

function fakeClock(start = 0) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(handler, ms) { const id = ++nextId; timers.set(id, { at: now + ms, handler }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
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

/** Who is asking, as the authentication layer resolved it. */
const CLIENTS = {
  desktop: { clientId: "desktop", authScope: "admin" },
  writer: { clientId: "writer", authScope: "write" },
  reader: { clientId: "reader", authScope: "read" },
  project: { clientId: "project", authScope: "admin", claims: { projectId: "project-a" } },
  session: { clientId: "session", authScope: "admin", claims: { sessionId: "session-a" } },
  capability: { clientId: "capability", authScope: "admin", claims: { capabilityId: "cap-1" } },
  mcp: { clientId: "system:mcp", authScope: "admin" },
};

function harness() {
  const clock = fakeClock(1_000);
  let nextId = 0;
  const manager = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, createId: () => `n-${++nextId}` });
  const journal = [];
  const acknowledged = [];
  const registry = createNotificationOperationRegistry({
    manager,
    eventJournal: { append: (event, payload) => journal.push({ event, payload }) },
    acknowledgeTerminal: () => {},
    acknowledgeBot: (botId, through) => acknowledged.push([botId, through]),
  });
  const request = (client, payload = {}) => ({
    envelope: { payload },
    context: { ...client, signal: new AbortController().signal },
  });
  const query = (name, client, payload) => registry.operations.queries[name](request(client, payload));
  const command = (name, client, payload) => registry.operations.commands[name](request(client, payload));
  return { clock, manager, journal, acknowledged, query, command };
}

const posts = (count, throughSequence) => ({ count, body: "Build is green", throughSequence, raisedAt: 2_000 });

test("only a client with bot authority receives a bot record in a snapshot", () => {
  const { clock, manager, query } = harness();
  manager.setActivity({ projectId: "project-a", sessionId: "session-a" }, "attention");
  manager.setBot("bot-a", posts(1, 3));
  clock.advance(5_000);
  const owners = (client) => Object.values(query(OP.snapshot, client).notifications).map((r) => r.owner).sort();
  assert.deepEqual(owners(CLIENTS.desktop), ["bot", "terminal"]);
  assert.deepEqual(owners(CLIENTS.writer), ["bot", "terminal"]);
  assert.deepEqual(owners(CLIENTS.reader), ["terminal"]);
  assert.deepEqual(owners(CLIENTS.project), ["terminal"]);
  assert.deepEqual(owners(CLIENTS.session), ["terminal"]);
  assert.deepEqual(owners(CLIENTS.capability), ["terminal"]);
});

test("a delta withholds bot publications, changes and removals from a client without bot authority", () => {
  const { clock, manager, query } = harness();
  manager.setBot("bot-a", posts(1, 3));
  clock.advance(5_000);
  manager.setBot("bot-a", posts(2, 4));
  manager.setBot("bot-a", undefined);
  const types = (client) => query(OP.delta, client, { revision: 0, cursor: "0" }).events.map((e) => e.type);
  assert.deepEqual(types(CLIENTS.desktop), ["notification.published", "notification.changed", "notification.removed"]);
  for (const client of [CLIENTS.reader, CLIENTS.project, CLIENTS.session, CLIENTS.capability])
    assert.deepEqual(types(client), [], client.clientId);
});

test("live delivery of bot events is projected by owner, removals included", () => {
  const { clock, manager, journal } = harness();
  manager.setBot("bot-a", posts(1, 3));
  clock.advance(5_000);
  manager.setBot("bot-a", undefined);
  const project = createNotificationEventProjector();
  const delivered = (client) =>
    journal
      .map((entry) => project({ event: entry.event, payload: entry.payload }, client))
      .filter((event) => event !== undefined)
      .map((event) => event.payload.type);
  assert.deepEqual(delivered(CLIENTS.desktop), ["notification.published", "notification.removed"]);
  for (const client of [CLIENTS.reader, CLIENTS.project, CLIENTS.session, CLIENTS.capability, CLIENTS.mcp, undefined])
    assert.deepEqual(delivered(client), [], client?.clientId ?? "unauthenticated");
});

test("a terminal event still reaches a project-scoped client of its project", () => {
  const { clock, manager, journal } = harness();
  manager.setActivity({ projectId: "project-a", sessionId: "session-a" }, "attention");
  manager.setActivity({ projectId: "project-b", sessionId: "session-b" }, "attention");
  clock.advance(5_000);
  const project = createNotificationEventProjector();
  const delivered = journal
    .map((entry) => project({ event: entry.event, payload: entry.payload }, CLIENTS.project))
    .filter((event) => event !== undefined)
    .map((event) => event.payload.projectId);
  assert.deepEqual(delivered, ["project-a"]);
});

test("a dismissal naming both a terminal and a bot, or neither, is refused", () => {
  const { command } = harness();
  assert.throws(() => command(OP.dismiss, CLIENTS.desktop, { id: "n-1", botId: "bot-a", projectId: "project-a", sessionId: "session-a" }), (e) => /exactly one/.test(e.message));
  assert.throws(() => command(OP.dismiss, CLIENTS.desktop, { id: "n-1" }), (e) => /exactly one/.test(e.message));
});

test("dismissing a bot notification requires bot authority", () => {
  const { clock, manager, acknowledged, command } = harness();
  manager.setBot("bot-a", posts(1, 3));
  clock.advance(5_000);
  for (const client of [CLIENTS.reader, CLIENTS.project, CLIENTS.capability])
    assert.throws(() => command(OP.dismiss, client, { id: "n-1", botId: "bot-a" }), (e) => e.code === "forbidden" && /bot authority/.test(e.message));
  assert.deepEqual(acknowledged, []);
  assert.equal(Object.keys(manager.snapshot().notifications).length, 1);
});

test("an authorized dismissal acknowledges through the dismissed record's sequence", () => {
  const { clock, manager, acknowledged, command } = harness();
  manager.setBot("bot-a", posts(2, 7));
  clock.advance(5_000);
  const result = command(OP.dismiss, CLIENTS.desktop, { id: "n-1", botId: "bot-a" });
  assert.equal(result.dismissed, true);
  // A post stored at 8 after the record was shown is not covered.
  assert.deepEqual(acknowledged, [["bot-a", 7]]);
});

test("a dismissal acknowledges no further than what the client was shown", () => {
  const { clock, manager, acknowledged, command } = harness();
  manager.setBot("bot-a", posts(1, 7));
  clock.advance(5_000);
  // A post at 8 updates the record in place after the client read it.
  manager.setBot("bot-a", posts(2, 8));
  command(OP.dismiss, CLIENTS.desktop, { id: "n-1", botId: "bot-a", throughSequence: 7 });
  // And a client cannot reach past the record by claiming more.
  command(OP.dismiss, CLIENTS.desktop, { id: "n-1", botId: "bot-a", throughSequence: 99 });
  assert.deepEqual(acknowledged, [["bot-a", 7], ["bot-a", 8]]);
});

test("a bot id that does not own the notification dismisses nothing", () => {
  const { clock, manager, acknowledged, command } = harness();
  manager.setBot("bot-a", posts(1, 3));
  clock.advance(5_000);
  assert.equal(command(OP.dismiss, CLIENTS.desktop, { id: "n-1", botId: "bot-b" }).dismissed, false);
  assert.equal(command(OP.dismiss, CLIENTS.desktop, { id: "n-1", projectId: "project-a", sessionId: "session-a" }).dismissed, false);
  assert.deepEqual(acknowledged, []);
});
