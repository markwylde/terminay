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
  // Re-checked after every notification event any client applies.
  const waiters = new Set();
  const changed = () => { for (const waiter of [...waiters]) waiter(); };
  /** Settles once `check` holds, re-checked as each notification event arrives. */
  const until = (check) => {
    if (check()) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = () => {
        if (!check()) return;
        waiters.delete(waiter);
        resolve();
      };
      waiters.add(waiter);
    });
  };

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
        subscription.onEvent((value) => { listener(value); changed(); });
        if (onResync !== undefined) subscription.onResync(onResync);
        return () => void subscription.unsubscribe().catch(() => undefined);
      },
    });
    return { client, notifications: notificationClient };
  }
  return { clock, activity, manager: notifications, composition, connect, until, changed };
}

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
  const { clock, activity, connect, until } = await served(t);
  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(2_000);

  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();
  assert.deepEqual(listed(desktop), [], "a pending notification is in no snapshot");

  clock.advance(3_000);
  await until(() => listed(desktop).length > 0);
  assert.deepEqual(listed(desktop).map((record) => [record.kind, record.sessionId, record.projectId]), [["attention", "session-a", "project-a"]]);
});

test("a dismissal reaches a second client, and an activity dismissal acknowledges the terminal", async (t) => {
  const { clock, activity, connect, until } = await served(t);
  const desktop = await connect("desktop");
  const browser = await connect("browser");
  await desktop.notifications.subscribe();
  await browser.notifications.subscribe();

  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(5_000);
  await until(() => listed(browser).length > 0 && listed(desktop).length > 0);
  assert.equal(listed(browser).length, 1);

  await desktop.notifications.dismiss(listed(desktop)[0]);
  await until(() => listed(desktop).length === 0 && listed(browser).length === 0);
  assert.deepEqual(listed(desktop), []);
  assert.deepEqual(listed(browser), []);
  const session = activity.get(identity());
  assert.equal(session.attention, false);
  assert.equal(session.acknowledged, true);
});

test("dismissing a sent notification removes only that one", async (t) => {
  const { clock, activity, manager, connect, until } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();

  activity.ingestSignal(identity(), { kind: "bell" });
  manager.send({ projectId: "project-a", sessionId: "session-a" }, { title: "Review ready", body: "Three files changed" });
  clock.advance(5_000);
  await until(() => listed(desktop).length >= 2);
  assert.equal(listed(desktop).length, 2);

  const sent = listed(desktop).find((record) => record.source === "message");
  assert.equal(sent.title, "Review ready");
  assert.equal(sent.body, "Three files changed");
  await desktop.notifications.dismiss(sent);
  await until(() => !listed(desktop).some((record) => record.source === "message"));
  // Catch up on anything else published since, so nothing can still be on its way.
  await desktop.notifications.replay();
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
  const { clock, activity, connect, until } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();
  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(5_000);
  await until(() => listed(desktop).length > 0);
  const [record] = listed(desktop);

  // A dismissal publishes its removal before it answers, so catching up on
  // what the server published since leaves nothing still on its way.
  for (const wrong of [{ ...record, projectId: "project-b" }, { ...record, sessionId: "session-b" }, { ...record, id: "n-unknown" }]) {
    await desktop.client.command(SERVER_OPERATIONS.dismiss, { id: wrong.id, projectId: wrong.projectId, sessionId: wrong.sessionId });
    await desktop.notifications.replay();
    assert.equal(listed(desktop).length, 1, "a mismatched dismissal removes nothing");
  }
  await assert.rejects(desktop.client.command(SERVER_OPERATIONS.dismiss, { id: record.id, projectId: "project-a" }));
  await desktop.notifications.replay();
  assert.equal(listed(desktop).length, 1);
  assert.equal(activity.get(identity()).attention, true);
});

test("a project-scoped client receives only its own terminals' notifications", async (t) => {
  const { clock, activity, connect, until, changed } = await served(t);
  const scoped = await connect("scoped-project-a");
  const events = [];
  const subscription = await scoped.client.subscribe(SERVER_OPERATIONS.event);
  subscription.onEvent((event) => { events.push(event.payload); changed(); });

  activity.ingestSignal(identity("session-b", "project-b"), { kind: "bell" });
  activity.ingestSignal(identity("session-a", "project-a"), { kind: "bell" });
  clock.advance(5_000);
  // Project B's bell settles first, so anything of it would arrive ahead of A's.
  await until(() => events.some((event) => event.sessionId === "session-a"));

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

test("a passive acknowledgement clears a terminal's activity and leaves what a process sent", async (t) => {
  const { clock, activity, manager, connect, until } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();

  // A bell and a sent notification on the terminal the user is sitting in.
  activity.ingestSignal(identity(), { kind: "bell" });
  manager.send({ projectId: "project-a", sessionId: "session-a" }, { body: "come back" });
  // The client judges the bell not news to a user who did nothing.
  await desktop.client.command("activity.acknowledge", { projectId: "project-a", sessionId: "session-a", passive: true });
  assert.equal(activity.get(identity()).acknowledged, true);

  clock.advance(5_000);
  await until(() => listed(desktop).length > 0);
  await desktop.notifications.replay();
  assert.deepEqual(listed(desktop).map((record) => record.kind), ["message"], "only the sent notification is published");

  // Something the user does in the terminal clears that too.
  await desktop.client.command("activity.acknowledge", { projectId: "project-a", sessionId: "session-a" });
  await until(() => listed(desktop).length === 0);
  assert.deepEqual(listed(desktop), []);

  await assert.rejects(desktop.client.command("activity.acknowledge", { projectId: "project-a", sessionId: "session-a", passive: "yes" }));
});

test("a delta with a cursor that does not match its revision is refused", async (t) => {
  const { connect } = await served(t);
  const desktop = await connect("desktop");
  await assert.rejects(desktop.client.query(SERVER_OPERATIONS.delta, { revision: 0, cursor: "1" }));
  await assert.rejects(desktop.client.query(SERVER_OPERATIONS.delta, { revision: -1, cursor: "-1" }));
});

test("closing a terminal removes its notifications for connected clients", async (t) => {
  const { clock, activity, connect, until } = await served(t);
  const desktop = await connect("desktop");
  await desktop.notifications.subscribe();
  activity.ingestSignal(identity(), { kind: "bell" });
  clock.advance(5_000);
  await until(() => listed(desktop).length > 0);
  assert.equal(listed(desktop).length, 1);
  activity.markExited(identity());
  await until(() => listed(desktop).length === 0);
  assert.deepEqual(listed(desktop), []);
});
