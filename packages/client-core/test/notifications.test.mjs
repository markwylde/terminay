import assert from "node:assert/strict";
import test from "node:test";
import { NotificationClient, NotificationSnapshotStore } from "../dist/index.js";

const record = (id, overrides = {}) => ({
  id,
  projectId: "project-a",
  sessionId: "session-a",
  source: "activity",
  kind: "agent-finished",
  raisedAt: 1,
  ...overrides,
});
const published = (revision, notification) => ({
  revision,
  cursor: String(revision),
  type: "notification.published",
  id: notification.id,
  projectId: notification.projectId,
  sessionId: notification.sessionId,
  notification,
});
const removed = (revision, notification) => ({
  revision,
  cursor: String(revision),
  type: "notification.removed",
  id: notification.id,
  projectId: notification.projectId,
  sessionId: notification.sessionId,
});
const ids = (store) => Object.keys(store.snapshot.notifications);

test("contiguous events are applied in order", () => {
  const store = new NotificationSnapshotStore();
  const seen = [];
  store.subscribe((snapshot) => seen.push(Object.keys(snapshot.notifications).length));
  assert.equal(store.applyEvent(published(1, record("n-1"))).kind, "applied");
  assert.equal(store.applyEvent(published(2, record("n-2", { sessionId: "session-b" }))).kind, "applied");
  assert.equal(store.applyEvent({ ...published(3, record("n-1", { kind: "agent-waiting" })), type: "notification.changed" }).kind, "applied");
  assert.equal(store.snapshot.notifications["n-1"].kind, "agent-waiting");
  assert.equal(store.applyEvent(removed(4, record("n-2"))).kind, "applied");
  assert.deepEqual(ids(store), ["n-1"]);
  assert.equal(store.revision, 4);
  assert.deepEqual(seen, [1, 2, 2, 1]);
});

test("an already applied event is ignored and a gap asks for a resync", () => {
  const store = new NotificationSnapshotStore();
  store.applyEvent(published(1, record("n-1")));
  assert.equal(store.applyEvent(published(1, record("n-1"))).kind, "ignored");
  const gap = store.applyEvent(published(3, record("n-3")));
  assert.deepEqual(gap, { kind: "resync_required", afterRevision: 1, receivedRevision: 3 });
  assert.deepEqual(ids(store), ["n-1"], "a gap applies nothing");
});

test("a resync replaces the projection, including with a lower revision", () => {
  const store = new NotificationSnapshotStore();
  store.applyEvent(published(1, record("n-1")));
  store.applyEvent(published(2, record("n-2")));
  assert.equal(store.applySnapshot({ revision: 1, cursor: "1", notifications: {} }).kind, "ignored", "an ordinary refresh never goes backwards");
  // A restarted server begins its revision sequence again.
  const result = store.reset({ revision: 1, cursor: "1", notifications: { "n-9": record("n-9") } });
  assert.equal(result.kind, "applied");
  assert.deepEqual(ids(store), ["n-9"]);
  assert.equal(store.revision, 1);
  assert.equal(store.applyReplay({ kind: "resync", events: [], snapshot: { revision: 0, cursor: "0", notifications: {} } }).kind, "applied");
  assert.deepEqual(ids(store), []);
});

test("a sent notification keeps its text and an activity notification carries none", () => {
  const store = new NotificationSnapshotStore();
  store.applyEvent(published(1, record("n-1", { source: "message", kind: "message", title: "Review ready", body: "Three files changed" })));
  assert.equal(store.snapshot.notifications["n-1"].title, "Review ready");
  assert.equal(store.snapshot.notifications["n-1"].body, "Three files changed");
  store.applyEvent(published(2, record("n-2", { title: "smuggled", body: "smuggled" })));
  assert.equal(store.snapshot.notifications["n-2"].title, undefined);
  assert.equal(store.snapshot.notifications["n-2"].body, undefined);
});

test("malformed records and events are refused", () => {
  const store = new NotificationSnapshotStore();
  assert.throws(() => store.applyEvent(published(1, record("n-1", { kind: "nonsense" }))), TypeError);
  assert.throws(() => store.applyEvent(published(1, record("n-1", { source: "message" }))), TypeError, "kind and source must agree");
  assert.throws(() => store.applyEvent(published(1, record("n-1", { source: "message", kind: "message", body: "x".repeat(281) }))), TypeError);
  assert.throws(() => store.applyEvent({ ...published(1, record("n-1")), id: "n-2" }), TypeError);
  assert.throws(() => store.applyEvent({ ...published(1, record("n-1")), cursor: "2" }), TypeError);
  assert.throws(() => store.applyEvent({ ...published(1, record("n-1")), notification: undefined }), TypeError);
  assert.throws(() => store.applySnapshot({ revision: 1, cursor: "1", notifications: { other: record("n-1") } }), TypeError);
  assert.deepEqual(ids(store), []);
});

test("the client converges on the server snapshot after a live replay gap", async () => {
  const requests = [];
  let listener;
  let canonical = { revision: 1, cursor: "1", notifications: { "n-1": record("n-1") } };
  const client = new NotificationClient({
    query: async (operation, payload) => {
      requests.push({ operation, payload });
      return operation === "notifications.snapshot" ? canonical : { kind: "events", events: [] };
    },
    command: async (operation, payload) => { requests.push({ operation, payload }); return null; },
    subscribe: async (_event, next) => { listener = next; return () => { listener = undefined; }; },
  });
  await client.subscribe();
  assert.deepEqual(ids(client.store), ["n-1"]);

  canonical = { revision: 5, cursor: "5", notifications: { "n-5": record("n-5") } };
  listener({ payload: published(5, record("n-5")) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ids(client.store), ["n-5"]);

  await client.dismiss(record("n-5"));
  assert.deepEqual(requests.at(-1), { operation: "notifications.dismiss", payload: { id: "n-5", projectId: "project-a", sessionId: "session-a" } });
  client.close();
  assert.equal(listener, undefined);
});

test("a transport without subscriptions is refused", () => {
  assert.throws(() => new NotificationClient({ query: async () => null, command: async () => null }));
});

const botRecord = (id, overrides = {}) => ({
  id,
  owner: "bot",
  botId: "bot-a",
  source: "bot",
  kind: "bot-message",
  body: "Build is green",
  count: 2,
  throughSequence: 7,
  raisedAt: 5,
  ...overrides,
});

test("a record from a server that names no owner reads as a terminal record", () => {
  const store = new NotificationSnapshotStore();
  store.applySnapshot({ revision: 1, cursor: "1", notifications: { "n-1": record("n-1") } });
  assert.equal(store.snapshot.notifications["n-1"].owner, "terminal");
});

test("a bot record is kept with its bot identity and nothing of a terminal", () => {
  const store = new NotificationSnapshotStore();
  const bot = botRecord("n-2");
  store.applyEvent({ revision: 1, cursor: "1", type: "notification.published", id: "n-2", owner: "bot", botId: "bot-a", notification: bot });
  assert.deepEqual({ ...store.snapshot.notifications["n-2"] }, bot);
  store.applyEvent({ revision: 2, cursor: "2", type: "notification.removed", id: "n-2", owner: "bot", botId: "bot-a" });
  assert.deepEqual(store.snapshot.notifications, {});
});

test("a record mixing a terminal and a bot, or missing its owner's identity, is refused", () => {
  const refuse = (notification) =>
    assert.throws(() => new NotificationSnapshotStore().applySnapshot({ revision: 1, cursor: "1", notifications: { [notification.id]: notification } }), TypeError);
  refuse(botRecord("n-1", { projectId: "project-a" }));
  refuse(botRecord("n-1", { sessionId: "session-a" }));
  refuse(botRecord("n-1", { botId: undefined }));
  refuse(botRecord("n-1", { count: 0 }));
  refuse(botRecord("n-1", { body: "x".repeat(281) }));
  refuse(record("n-1", { botId: "bot-a" }));
  refuse(record("n-1", { owner: "terminal", projectId: undefined }));
  refuse(record("n-1", { owner: "someone" }));
});

test("dismissing a bot notification names the bot and no terminal", async () => {
  const sent = [];
  const client = new NotificationClient({
    query: async () => ({ revision: 0, cursor: "0", notifications: {} }),
    command: async (operation, payload) => { sent.push([operation, payload]); return {}; },
    subscribe: async () => () => {},
  });
  await client.dismiss({ id: "n-2", botId: "bot-a" });
  await client.dismiss({ id: "n-1", projectId: "project-a", sessionId: "session-a" });
  assert.deepEqual(sent, [
    ["notifications.dismiss", { id: "n-2", botId: "bot-a" }],
    ["notifications.dismiss", { id: "n-1", projectId: "project-a", sessionId: "session-a" }],
  ]);
});
