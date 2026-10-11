import assert from "node:assert/strict";
import test from "node:test";
import { NOTIFICATION_OPERATIONS as CLIENT_OPERATIONS, NotificationClient, TerminayClient } from "@terminay/client-core";
import { encodeFrame } from "@terminay/protocol";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  createNotificationEventProjector,
  createServerCoreComposition,
  NOTIFICATION_OPERATIONS as SERVER_OPERATIONS,
  NotificationManager,
  TerminalActivityService,
} from "../dist/index.js";

const SERVER = "notifications";
const identity = (sessionId = "session-a", projectId = "project-a") => ({ serverId: SERVER, projectId, sessionId });

function fakeClock(start = 0) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(handler, milliseconds) { const id = ++nextId; timers.set(id, { at: now + milliseconds, handler }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].handler();
      }
      now = target;
    },
  };
}

const quietPty = {
  spawn: () => ({
    pid: 4242,
    write() {}, resize() {}, kill() {},
    onData() { return () => {}; },
    onExit() { return () => {}; },
    onForegroundProcess() { return () => {}; },
    async refreshForegroundProcess() {},
  }),
};

async function served(t) {
  const clock = fakeClock(1_000);
  const activity = new TerminalActivityService({ serverId: SERVER, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const notifications = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: quietPty,
    activity,
    notifications,
    authenticate: ({ hello }) => ({
      clientId: hello.clientId,
      authScope: "admin",
      ...(hello.clientId.startsWith("scoped-") ? { claims: { projectId: hello.clientId.slice("scoped-".length) } } : {}),
    }),
  });
  await composition.terminal.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  await composition.terminal.createSession({ projectId: "project-b", sessionId: "session-b", cols: 80, rows: 24 });
  const closers = [];
  t.after(async () => {
    for (const close of closers) await close();
    await composition.shutdown();
  });

  async function connect(clientId) {
    const pair = createInMemoryTransportPair();
    const serverTask = composition.core.accept(pair.server).start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: ["events.resync"] });
    closers.push(async () => {
      await client.close().catch(() => undefined);
      await serverTask.catch(() => undefined);
    });
    await pair.open();
    await client.connect();
    const notificationClient = new NotificationClient({
      query: async (operation, payload, options) => (await client.query(operation, payload, options)).result,
      command: async (operation, payload, options) => (await client.command(operation, payload, options)).result,
      subscribe: async (event, listener, onResync) => {
        const subscription = await client.subscribe(event);
        subscription.onEvent(listener);
        if (onResync !== undefined) subscription.onResync(onResync);
        return () => void subscription.unsubscribe().catch(() => undefined);
      },
    });
    return { client, notifications: notificationClient };
  }
  return { clock, activity, manager: notifications, composition, connect };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
const listed = (client) => Object.values(client.notifications.store.snapshot.notifications);

test("the composition builds a notification manager alongside activity", async (t) => {
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: quietPty,
    activity: new TerminalActivityService({ serverId: SERVER }),
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "admin" }),
  });
  t.after(() => composition.shutdown());
  assert.ok(composition.notifications instanceof NotificationManager);
});

test("every notification operation name can be encoded on the wire, and both sides agree on it", () => {
  assert.deepEqual({ ...CLIENT_OPERATIONS }, { ...SERVER_OPERATIONS });
  for (const operation of Object.values(SERVER_OPERATIONS)) {
    if (operation === SERVER_OPERATIONS.event) continue;
    assert.doesNotThrow(
      () => encodeFrame({ type: "query", queryId: "q1", operation, payload: {} }),
      `${operation} is not a valid wire operation name`,
    );
  }
});

test("a client that connects during a settle period sees nothing, then receives the publication", async (t) => {
  const { clock, activity, connect } = await served(t);
  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(2_000);

  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();
  assert.deepEqual(listed(desktop), [], "a pending notification is in no snapshot");

  clock.advance(3_000);
  await settled();
  assert.deepEqual(listed(desktop).map((record) => [record.kind, record.sessionId, record.projectId]), [["attention", "session-a", "project-a"]]);
});

test("a dismissal reaches a second client, and an activity dismissal acknowledges the terminal", async (t) => {
  const { clock, activity, connect } = await served(t);
  const desktop = await connect("desktop");
  const browser = await connect("browser");
  await desktop.notifications.subscribe();
  await browser.notifications.subscribe();

  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(5_000);
  await settled();
  assert.equal(listed(browser).length, 1);

  await desktop.notifications.dismiss(listed(desktop)[0]);
  await settled();
  assert.deepEqual(listed(desktop), []);
  assert.deepEqual(listed(browser), []);
  const session = activity.get(identity());
  assert.equal(session.attention, false);
  assert.equal(session.acknowledged, true);
});

test("dismissing a sent notification removes only that one", async (t) => {
  const { clock, activity, manager, connect } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();

  activity.ingestSignal(identity(), { kind: "bell" });
  manager.send({ projectId: "project-a", sessionId: "session-a" }, { title: "Review ready", body: "Three files changed" });
  clock.advance(5_000);
  await settled();
  assert.equal(listed(desktop).length, 2);

  const sent = listed(desktop).find((record) => record.source === "message");
  assert.equal(sent.title, "Review ready");
  assert.equal(sent.body, "Three files changed");
  await desktop.notifications.dismiss(sent);
  await settled();
  assert.deepEqual(listed(desktop).map((record) => record.kind), ["attention"]);
  assert.equal(activity.get(identity()).attention, true, "the terminal was not acknowledged");
});

test("sending and dismissing a notification leave terminal activity untouched", async (t) => {
  const { clock, activity, manager } = await served(t);
  const before = activity.get(identity());
  const revision = activity.revision;
  const sent = manager.send({ projectId: "project-a", sessionId: "session-a" }, { body: "hello" });
  clock.advance(5_000);
  assert.deepEqual(activity.get(identity()), before);
  manager.dismissSent("session-a", sent.id);
  assert.deepEqual(activity.get(identity()), before);
  assert.equal(activity.revision, revision, "no activity event was published");
});

test("a dismissal naming another project or session is not accepted", async (t) => {
  const { clock, activity, connect } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();
  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(5_000);
  await settled();
  const [record] = listed(desktop);

  for (const wrong of [{ ...record, projectId: "project-b" }, { ...record, sessionId: "session-b" }, { ...record, id: "n-unknown" }]) {
    await desktop.client.command(SERVER_OPERATIONS.dismiss, { id: wrong.id, projectId: wrong.projectId, sessionId: wrong.sessionId });
    await settled();
    assert.equal(listed(desktop).length, 1, "a mismatched dismissal removes nothing");
  }
  await assert.rejects(desktop.client.command(SERVER_OPERATIONS.dismiss, { id: record.id, projectId: "project-a" }));
  await settled();
  assert.equal(listed(desktop).length, 1);
  assert.equal(activity.get(identity()).attention, true);
});

test("a project-scoped client receives only its own terminals' notifications", async (t) => {
  const { clock, activity, connect } = await served(t);
  const scoped = await connect("scoped-project-a");
  const events = [];
  const subscription = await scoped.client.subscribe(SERVER_OPERATIONS.event);
  subscription.onEvent((event) => events.push(event.payload));

  activity.ingestSignal(identity("session-b", "project-b"), { kind: "bell" });
  activity.ingestSignal(identity("session-a", "project-a"), { kind: "bell" });
  clock.advance(5_000);
  await settled();

  assert.deepEqual(events.map((event) => event.sessionId), ["session-a"]);
  const snapshot = (await scoped.client.query(SERVER_OPERATIONS.snapshot, {})).result;
  assert.deepEqual(Object.values(snapshot.notifications).map((record) => record.projectId), ["project-a"]);
  const delta = (await scoped.client.query(SERVER_OPERATIONS.delta, { revision: 0, cursor: "0" })).result;
  assert.deepEqual(delta.events.map((event) => event.projectId), ["project-a"]);

  const desktop = await connect("desktop");
  const other = Object.values((await desktop.client.query(SERVER_OPERATIONS.snapshot, {})).result.notifications).find((record) => record.projectId === "project-b");
  await assert.rejects(scoped.client.command(SERVER_OPERATIONS.dismiss, { id: other.id, projectId: "project-b", sessionId: "session-b" }));

  const projector = createNotificationEventProjector();
  const journalEvent = { event: SERVER_OPERATIONS.event, payload: { projectId: "project-b", sessionId: "session-b" } };
  assert.equal(projector(journalEvent, { clientId: "c", authScope: "read", claims: { projectId: "project-a" } }), undefined);
  assert.equal(projector(journalEvent, { clientId: "c", authScope: "read" }), journalEvent);
});

test("a notification sent to the terminal a client's user is in is acknowledged before it is published", async (t) => {
  const { clock, activity, manager, connect } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();
  const published = [];
  desktop.notifications.store.subscribe((snapshot) => published.push(Object.keys(snapshot.notifications).length));

  // This client's user is typing in session-a and nowhere else.
  const probes = [];
  await desktop.notifications.onProbe((probe) => {
    probes.push(probe);
    if (probe.sessionId !== "session-a") return;
    void desktop.client.command("activity.acknowledge", { projectId: probe.projectId, sessionId: probe.sessionId });
  });

  manager.send({ projectId: "project-a", sessionId: "session-a" }, { body: "you are already here" });
  manager.send({ projectId: "project-b", sessionId: "session-b" }, { body: "over here" });
  await settled();
  assert.deepEqual(probes, [
    { projectId: "project-a", sessionId: "session-a" },
    { projectId: "project-b", sessionId: "session-b" },
  ]);
  assert.equal(manager.pendingCount, 1, "the acknowledged terminal's notification is gone while still pending");

  clock.advance(5_000);
  await settled();
  assert.deepEqual(listed(desktop).map((record) => record.sessionId), ["session-b"]);
  assert.deepEqual(published, [1], "the viewed notification was never published");
  assert.equal(activity.get(identity()).acknowledged, true);
});

test("a delta with a cursor that does not match its revision is refused", async (t) => {
  const { connect } = await served(t);
  const desktop = await connect("desktop");
  await assert.rejects(desktop.client.query(SERVER_OPERATIONS.delta, { revision: 0, cursor: "1" }));
  await assert.rejects(desktop.client.query(SERVER_OPERATIONS.delta, { revision: -1, cursor: "-1" }));
});

test("closing a terminal removes its notifications for connected clients", async (t) => {
  const { clock, activity, connect } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();
  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(5_000);
  await settled();
  assert.equal(listed(desktop).length, 1);
  activity.markExited(identity());
  await settled();
  assert.deepEqual(listed(desktop), []);
});
