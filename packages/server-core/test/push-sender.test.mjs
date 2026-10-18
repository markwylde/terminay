import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { FEATURE_CAPABILITIES, openPushPayload, PUSH_SEALED_BYTES } from "@terminay/protocol";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  createFilePushEnrolmentPersistence,
  createPushOperationRegistry,
  createServerCoreComposition,
  NotificationManager,
  PUSH_OPERATIONS,
  PushEnrolmentStore,
  PushSender,
  TerminalActivityService,
} from "../dist/index.js";

const ORIGIN = "https://push.example.test";
const owner = (sessionId = "session-a", projectId = "project-a") => ({ projectId, sessionId });
const enrolment = (silent = true) => ({
  routingId: randomBytes(16).toString("base64url"),
  key: randomBytes(32).toString("base64url"),
  token: randomBytes(32).toString("base64url"),
  silent,
});

function fakeClock(start = 1_000_000) {
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


function harness(options = {}) {
  const clock = fakeClock();
  const notifications = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, sendRateLimit: 1_000 });
  const enrolments = new PushEnrolmentStore();
  const requests = [];
  const requestWaiters = new Set();
  let respond = options.respond ?? (() => ({ status: 202 }));
  const sender = new PushSender({
    notifications,
    enrolments,
    origin: ORIGIN,
    describe: options.describe ?? ((record) => ({ terminalTitle: `Terminal for ${record.sessionId}`, projectTitle: `Project ${record.projectId}` })),
    transport: async (url, init) => {
      requests.push({ url, headers: init.headers, body: init.body, signal: init.signal });
      for (const waiter of [...requestWaiters]) waiter();
      return respond(requests.length, init);
    },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  /** Advance the clock and let whatever fired finish. Sealing runs off the
   * event loop, so this waits on the sender itself, not on a number of turns.
   * A test that leaves a request hanging advances the clock itself. */
  const run = async (milliseconds) => {
    clock.advance(milliseconds);
    await sender.whenIdle();
  };
  /** Settles once the service has been asked for `count` requests in all. */
  const requested = (count) => {
    if (requests.length >= count) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = () => {
        if (requests.length < count) return;
        requestWaiters.delete(waiter);
        resolve();
      };
      requestWaiters.add(waiter);
    });
  };
  const opened = (device, index = -1) => openPushPayload(device, requests.at(index).body);
  return { clock, notifications, enrolments, sender, requests, run, requested, opened, setRespond: (next) => { respond = next; } };
}

/** Raise an activity notification and wait out the settle period and the coalescing delay. */
async function publish(h, sessionId = "session-a", kind = "agent-finished") {
  h.notifications.setActivity(owner(sessionId), kind);
  await h.run(5_000);
  await h.run(250);
}

test("a device that is not watching is pushed the published notification, sealed for it", async () => {
  const h = harness();
  const device = enrolment();
  h.enrolments.set("device-a", device);

  await publish(h);
  assert.equal(h.requests.length, 1);
  const [request] = h.requests;
  assert.equal(request.url, `${ORIGIN}/v1/push`);
  assert.equal(request.headers.authorization, `Bearer ${device.token}`);
  assert.equal(request.headers["content-type"], "application/octet-stream");
  assert.equal(request.body.byteLength, PUSH_SEALED_BYTES);

  const state = await h.opened(device);
  assert.equal(state.count, 1);
  assert.equal(state.outstanding.length, 1);
  assert.equal(state.banner.kind, "agent-finished");
  assert.equal(state.banner.terminalTitle, "Terminal for session-a");
  assert.equal(state.banner.projectTitle, "Project project-a");
  assert.equal(state.banner.projectId, "project-a");
  assert.equal(state.banner.sessionId, "session-a");
  assert.equal(state.banner.id, state.outstanding[0]);
});

test("the request carries nothing but the token and the sealed bytes", async () => {
  const h = harness();
  const device = enrolment();
  h.enrolments.set("device-a", device);
  h.notifications.send(owner(), { title: "Secret title", body: "Secret body" });
  await h.run(5_000);
  await h.run(250);
  const [request] = h.requests;
  assert.deepEqual(Object.keys(request.headers).sort(), ["authorization", "content-type"]);
  const visible = `${request.url}\n${JSON.stringify(request.headers)}\n${Buffer.from(request.body).toString("latin1")}`;
  for (const secret of ["Secret title", "Secret body", "Terminal for", "session-a", "project-a", device.key])
    assert.equal(visible.includes(secret), false, secret);
});

test("a notification removed before it is published causes no push and no clear", async () => {
  const h = harness();
  h.enrolments.set("device-a", enrolment());
  h.notifications.setActivity(owner(), "agent-finished");
  await h.run(3_000);
  h.notifications.setActivity(owner(), undefined);
  await h.run(60_000);
  assert.equal(h.requests.length, 0);
});

test("a burst of changes is coalesced into one push that states the latest", async () => {
  const h = harness();
  const device = enrolment();
  h.enrolments.set("device-a", device);
  for (const session of ["s1", "s2", "s3"]) h.notifications.setActivity(owner(session), "attention", h.clock.now());
  await h.run(5_000);
  await h.run(250);
  assert.equal(h.requests.length, 1);
  const state = await h.opened(device);
  assert.equal(state.count, 3);
  assert.equal(state.outstanding.length, 3);
});

test("a device that is watching is sent nothing", async () => {
  const h = harness();
  h.sender.enrol("device-a", "connection-1", enrolment());
  assert.equal(h.sender.isWatching("device-a"), true);
  await publish(h);
  assert.equal(h.requests.length, 0);
});

test("one device watching leaves another device's pushes alone", async () => {
  const h = harness();
  const phone = enrolment();
  h.sender.enrol("tablet", "connection-1", enrolment());
  h.enrolments.set("phone", phone);
  await publish(h);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].headers.authorization, `Bearer ${phone.token}`);
});

test("a notification that arose while watching is pushed when the window is hidden", async () => {
  const h = harness();
  const device = enrolment();
  h.sender.enrol("device-a", "connection-1", device);
  await publish(h);
  assert.equal(h.requests.length, 0);

  h.sender.setVisibility("device-a", "connection-1", false);
  await h.run(250);
  assert.equal(h.requests.length, 1);
  const state = await h.opened(device);
  assert.equal(state.count, 1);
  assert.equal(state.banner.kind, "agent-finished");
});

test("a connection declared dead ends watching the same way", async () => {
  const h = harness();
  const device = enrolment();
  h.sender.enrol("device-a", "connection-1", device);
  await publish(h);
  h.sender.connectionClosed("connection-1");
  await h.run(250);
  assert.equal(h.requests.length, 1);
  assert.ok((await h.opened(device)).banner);
});

test("hiding a window with nothing new to say sends nothing", async () => {
  const h = harness();
  h.sender.enrol("device-a", "connection-1", enrolment());
  await publish(h);
  h.notifications.setActivity(owner(), undefined);
  h.sender.setVisibility("device-a", "connection-1", false);
  await h.run(1_000);
  assert.equal(h.requests.length, 0, "the window saw the notification come and go itself");
});

test("a device is watching while any one of its windows is visible", async () => {
  const h = harness();
  const device = enrolment();
  h.sender.enrol("device-a", "connection-1", device);
  h.sender.setVisibility("device-a", "connection-2", true);
  h.sender.setVisibility("device-a", "connection-1", false);
  await publish(h);
  assert.equal(h.requests.length, 0, "the second window is still in front");
  h.sender.connectionClosed("connection-2");
  await h.run(250);
  assert.equal(h.requests.length, 1);
});

test("a window that comes back before the push goes cancels it", async () => {
  const h = harness();
  h.sender.enrol("device-a", "connection-1", enrolment());
  await publish(h);
  h.sender.setVisibility("device-a", "connection-1", false);
  h.sender.setVisibility("device-a", "connection-1", true);
  await h.run(1_000);
  assert.equal(h.requests.length, 0);
});

test("an acknowledgement is pushed as state to an installation that accepts a silent push", async () => {
  const h = harness();
  const device = enrolment(true);
  h.enrolments.set("device-a", device);
  await publish(h);
  h.notifications.setActivity(owner(), undefined);
  await h.run(250);
  assert.equal(h.requests.length, 2);
  const clear = await h.opened(device);
  assert.equal(clear.banner, undefined);
  assert.equal(clear.count, 0);
  assert.deepEqual(clear.outstanding, []);
  assert.ok(clear.sequence > (await h.opened(device, 0)).sequence);
});

test("an acknowledgement is not pushed to an installation that does not accept a silent push", async () => {
  const h = harness();
  const device = enrolment(false);
  h.enrolments.set("device-a", device);
  await publish(h, "session-a");
  h.notifications.setActivity(owner("session-a"), undefined);
  await h.run(1_000);
  assert.equal(h.requests.length, 1, "no push that would show nothing");

  // The next banner carries the state that corrects the device.
  await publish(h, "session-b", "attention");
  assert.equal(h.requests.length, 2);
  const state = await h.opened(device);
  assert.equal(state.count, 1);
  assert.equal(state.banner.sessionId, "session-b");
  assert.equal(state.outstanding.length, 1);
});

test("a change of kind after publication is pushed as the same notification", async () => {
  const h = harness();
  const device = enrolment();
  h.enrolments.set("device-a", device);
  await publish(h, "session-a", "agent-waiting");
  const first = await h.opened(device);
  h.notifications.setActivity(owner(), "agent-finished");
  await h.run(250);
  const second = await h.opened(device);
  assert.equal(second.banner.id, first.banner.id);
  assert.equal(second.banner.kind, "agent-finished");
});

test("a sent notification's title and body travel inside the seal", async () => {
  const h = harness();
  const device = enrolment();
  h.enrolments.set("device-a", device);
  h.notifications.send(owner(), { title: "Review ready", body: "Three files changed" });
  await h.run(5_000);
  await h.run(250);
  const { banner } = await h.opened(device);
  assert.equal(banner.kind, "message");
  assert.equal(banner.messageTitle, "Review ready");
  assert.equal(banner.messageBody, "Three files changed");
  assert.equal(banner.terminalTitle, "Terminal for session-a");
});

test("a notification that must not leave the server is neither pushed nor counted", async () => {
  const h = harness({ describe: (record) => (record.projectId === "automation" ? undefined : { terminalTitle: "T", projectTitle: "P" }) });
  const device = enrolment();
  h.enrolments.set("device-a", device);
  h.notifications.setActivity(owner("hidden", "automation"), "attention");
  await h.run(5_000);
  await h.run(250);
  assert.equal(h.requests.length, 0);

  await publish(h, "session-a");
  const state = await h.opened(device);
  assert.equal(state.count, 1);
  assert.equal(state.outstanding.length, 1);
});

test("an enrolment the hosted service no longer holds is dropped", async () => {
  for (const status of [404, 410]) {
    const h = harness({ respond: () => ({ status }) });
    h.enrolments.set("device-a", enrolment());
    await publish(h);
    assert.equal(h.requests.length, 1);
    assert.equal(h.enrolments.get("device-a"), undefined);
    await publish(h, "session-b");
    assert.equal(h.requests.length, 1, "nothing further is sent");
  }
});

test("an outage is retried with bounded backoff and then states only what is current", async () => {
  const h = harness({ respond: () => ({ status: 502 }) });
  const device = enrolment();
  h.enrolments.set("device-a", device);
  await publish(h, "s1", "attention");
  assert.equal(h.requests.length, 1);
  await h.run(1_000);
  await h.run(5_000);
  await h.run(30_000);
  assert.equal(h.requests.length, 4, "three retries");
  await h.run(600_000);
  assert.equal(h.requests.length, 4, "and then it stops");
  assert.ok(h.enrolments.get("device-a"), "an outage does not end the enrolment");

  // The service returns. The first notification has been dealt with meanwhile.
  h.setRespond(() => ({ status: 202 }));
  h.notifications.setActivity(owner("s1"), undefined);
  await publish(h, "s2", "agent-finished");
  const state = await h.opened(device);
  assert.equal(state.count, 1);
  assert.equal(state.banner.sessionId, "s2");
  assert.equal(state.outstanding.length, 1, "nothing past was queued");
});

test("a refused or unreachable service is retried", async () => {
  for (const respond of [() => ({ status: 429 }), () => ({ status: 503 }), () => { throw new Error("network down"); }]) {
    const h = harness({ respond });
    h.enrolments.set("device-a", enrolment());
    await publish(h);
    await h.run(1_000);
    assert.equal(h.requests.length, 2);
  }
});

test("a hung service is abandoned at the request deadline and blocks nothing", async () => {
  const h = harness({ respond: (_count, init) => new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(new Error("aborted"))); }) });
  h.enrolments.set("device-a", enrolment());
  const events = [];
  h.notifications.subscribe((event) => events.push(event.type));

  // Published, coalesced, and sent; the request then hangs, so the sender
  // is not idle until its deadline, and the test advances the clock itself.
  h.notifications.setActivity(owner(), "agent-finished");
  await h.run(5_000);
  h.clock.advance(250);
  await h.requested(1);
  assert.equal(h.requests.length, 1);
  // The manager, and so every client, carries on while the request hangs.
  h.notifications.setActivity(owner("session-b"), "attention");
  h.clock.advance(5_000);
  h.notifications.setActivity(owner("session-a"), undefined);
  assert.deepEqual(events, ["notification.published", "notification.published", "notification.removed"]);

  await h.run(15_000);
  assert.equal(h.requests[0].signal.aborted, true);
});

test("a revoked device is sent nothing further, and others are unaffected", async () => {
  const h = harness();
  const kept = enrolment();
  h.enrolments.set("revoked", enrolment());
  h.enrolments.set("kept", kept);
  h.sender.removeDevice("revoked");
  assert.equal(h.enrolments.get("revoked"), undefined);
  await publish(h);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].headers.authorization, `Bearer ${kept.token}`);
});

test("resetting the server ends every enrolment", async () => {
  const h = harness();
  h.enrolments.set("a", enrolment());
  h.enrolments.set("b", enrolment());
  h.sender.clear();
  assert.deepEqual(h.enrolments.deviceIds(), []);
  await publish(h);
  assert.equal(h.requests.length, 0);
});

test("the sequence only increases for an enrolment", async () => {
  const h = harness();
  const device = enrolment();
  h.enrolments.set("device-a", device);
  const sequences = [];
  for (const session of ["s1", "s2", "s3"]) {
    await publish(h, session);
    sequences.push((await h.opened(device)).sequence);
  }
  assert.ok(sequences[0] < sequences[1] && sequences[1] < sequences[2], sequences.join(","));
});

test("shutdown stops pushing", async () => {
  const h = harness();
  h.enrolments.set("device-a", enrolment());
  h.sender.shutdown();
  await publish(h);
  assert.equal(h.requests.length, 0);
});

// --- enrolment storage ------------------------------------------------------

test("enrolments survive a restart in an owner-only file and hold no subscription", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "terminay-push-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "nested", "push-enrolments.v1.json");
  const device = enrolment(false);

  const first = new PushEnrolmentStore(createFilePushEnrolmentPersistence(file));
  first.set("device-a", device);
  first.set("device-b", enrolment());
  first.remove("device-b");

  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  const stored = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(stored.enrolments), ["device-a"]);
  assert.deepEqual(Object.keys(stored.enrolments["device-a"]).sort(), ["key", "routingId", "silent", "token"]);

  const second = new PushEnrolmentStore(createFilePushEnrolmentPersistence(file));
  assert.deepEqual(second.get("device-a"), device);
  assert.equal(second.get("device-b"), undefined);
});

test("a malformed stored record is dropped without costing the others", () => {
  const good = enrolment();
  const store = new PushEnrolmentStore({
    load: () => ({ good, bad: { ...good, key: "short" }, worse: "nonsense", extra: { ...good, endpoint: "https://example.test" } }),
    save: () => {},
  });
  assert.deepEqual(store.deviceIds(), ["good"]);
  assert.deepEqual(new PushEnrolmentStore({ load: () => { throw new Error("unreadable"); }, save: () => {} }).deviceIds(), []);
});

// --- protocol ---------------------------------------------------------------

const signal = new AbortController().signal;
const command = (payload, context = {}) => ({
  envelope: { operation: "push", commandId: "c", correlationId: "r", payload },
  body: new Uint8Array(),
  context: { connectionId: "connection-1", clientId: "client-1", deviceId: "device-a", authScope: "admin", signal, ...context },
});

test("enrolment is accepted only from a paired device, for that device", () => {
  const h = harness();
  const { operations } = createPushOperationRegistry({ sender: h.sender });
  const enrol = operations.commands[PUSH_OPERATIONS.enrol];
  const device = enrolment();

  assert.throws(() => enrol(command(device, { deviceId: undefined })), (error) => /paired device/.test(error.message));
  assert.throws(() => enrol(command(device, { authScope: "none" })), (error) => /paired device/.test(error.message));
  assert.equal(h.enrolments.deviceIds().length, 0);

  assert.deepEqual(enrol(command(device)), { enrolled: true });
  assert.deepEqual(h.enrolments.get("device-a"), device);
  assert.equal(h.sender.isWatching("device-a"), true);

  // No field names a device: an attempt to enrol on another's behalf is malformed.
  assert.throws(() => enrol(command({ ...enrolment(), deviceId: "device-b" }, { deviceId: "device-c" })), (error) => /invalid/.test(error.message));
  assert.equal(h.enrolments.get("device-b"), undefined);
  assert.equal(h.enrolments.get("device-c"), undefined);

  for (const bad of [{ ...device, key: "short" }, { ...device, endpoint: "https://example.test" }, { ...device, silent: 1 }, null, "x"])
    assert.throws(() => enrol(command(bad)), (error) => /invalid/.test(error.message));
});

test("withdrawing ends only the sender's own enrolment", () => {
  const h = harness();
  const { operations } = createPushOperationRegistry({ sender: h.sender });
  h.enrolments.set("device-a", enrolment());
  h.enrolments.set("device-b", enrolment());
  assert.deepEqual(operations.commands[PUSH_OPERATIONS.withdraw](command({})), { enrolled: false });
  assert.deepEqual(h.enrolments.deviceIds(), ["device-b"]);
  assert.throws(() => operations.commands[PUSH_OPERATIONS.withdraw](command({}, { deviceId: undefined })), (error) => /paired device/.test(error.message));
});

test("a visibility report moves only the reporting device and is harmless without one", async () => {
  const h = harness();
  const { operations } = createPushOperationRegistry({ sender: h.sender });
  const visibility = operations.commands[PUSH_OPERATIONS.visibility];
  operations.commands[PUSH_OPERATIONS.enrol](command(enrolment()));
  h.enrolments.set("device-b", enrolment());

  assert.deepEqual(visibility(command({ visible: false })), { visible: false });
  assert.equal(h.sender.isWatching("device-a"), false);
  assert.equal(h.sender.isWatching("device-b"), false);
  assert.deepEqual(visibility(command({ visible: true }, { deviceId: undefined })), { visible: true });
  assert.equal(h.sender.isWatching("device-a"), false, "a client with no device reports for no one");
  assert.throws(() => visibility(command({ visible: "yes" })), (error) => /invalid/.test(error.message));
  assert.throws(() => visibility(command(null)), (error) => /object/.test(error.message));
});

// --- composed ---------------------------------------------------------------

const quietPty = {
  spawn: () => ({
    pid: 4242, write() {}, resize() {}, kill() {},
    onData() { return () => {}; }, onExit() { return () => {}; }, onForegroundProcess() { return () => {}; },
    async refreshForegroundProcess() {},
  }),
};

test("a paired device enrols over a real connection and is pushed once it stops watching", async (t) => {
  const clock = fakeClock();
  const activity = new TerminalActivityService({ serverId: "push-server", now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const notifications = new NotificationManager({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const requests = [];
  const enrolments = new PushEnrolmentStore();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "push-server",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: quietPty,
    activity,
    notifications,
    push: {
      enrolments, origin: ORIGIN, transport: async (url, init) => { requests.push({ url, ...init }); return { status: 202 }; },
      now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    },
    authenticate: ({ hello }) => ({
      clientId: hello.clientId,
      authScope: "admin",
      ...(hello.clientId.startsWith("phone") ? { deviceId: "device-phone" } : {}),
    }),
  });
  assert.ok(composition.push instanceof PushSender);
  assert.equal(composition.coreOptions.capabilities.includes(FEATURE_CAPABILITIES.push), true);
  await composition.terminal.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });

  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair();
    const serverTask = composition.core.accept(pair.server).start();
    const client = new TerminayClient({ transport: pair.client, clientId });
    await pair.open();
    await client.connect();
    return { client, close: async () => { await client.close().catch(() => undefined); await serverTask.catch(() => undefined); } };
  };
  // The composed sender coalesces on the test's clock: let that pass, then
  // wait for whatever it sent.
  const coalesced = async () => {
    clock.advance(250);
    await composition.push.whenIdle();
  };
  const phone = await connect("phone-window");
  const desktop = await connect("desktop-window");
  t.after(async () => { await phone.close(); await desktop.close(); await composition.shutdown(); });

  const device = enrolment();
  await assert.rejects(desktop.client.command(PUSH_OPERATIONS.enrol, device), "Local Desktop has no device to enrol");
  await phone.client.command(PUSH_OPERATIONS.enrol, device);
  assert.deepEqual(enrolments.deviceIds(), ["device-phone"]);

  const identity = { serverId: "push-server", projectId: "project-a", sessionId: "session-a" };
  activity.ingestSignal(identity, { kind: "bell" });
  clock.advance(5_000);
  await coalesced();
  assert.equal(requests.length, 0, "the phone is watching");

  // The phone goes away without a word; the server sees its connection end.
  await phone.close();
  await coalesced();
  assert.equal(requests.length, 1);
  const state = await openPushPayload(device, requests[0].body);
  assert.equal(state.count, 1);
  assert.equal(state.banner.kind, "attention");
  assert.equal(state.banner.sessionId, "session-a");

  // Dealt with on Desktop: the clear follows.
  await desktop.client.command("activity.acknowledge", { projectId: "project-a", sessionId: "session-a" });
  await coalesced();
  assert.equal(requests.length, 2);
  assert.equal((await openPushPayload(device, requests[1].body)).count, 0);
});

test("a server composed without push advertises no push capability", async (t) => {
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "no-push",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: quietPty,
    activity: new TerminalActivityService({ serverId: "no-push" }),
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "admin" }),
  });
  t.after(() => composition.shutdown());
  assert.equal(composition.push, undefined);
  assert.equal(composition.coreOptions.capabilities.includes(FEATURE_CAPABILITIES.push), false);
});
