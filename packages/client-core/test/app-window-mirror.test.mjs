import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_WINDOW_EVENTS,
  APP_WINDOW_MIRROR_CAPABILITY,
  APP_WINDOW_OPERATIONS,
  AppWindowClient,
  MAX_APP_WINDOW_MIRROR_BATCH_BYTES,
  MAX_APP_WINDOW_MIRROR_SNAPSHOT_BYTES,
} from "../dist/index.js";

const bytes = (text) => new TextEncoder().encode(text);
const text = (body) => new TextDecoder().decode(body);

function transport(answers = {}) {
  const calls = [];
  const listeners = new Map();
  const gaps = new Map();
  const add = (event, listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    return () => listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener));
  };
  return {
    calls,
    emit: (event, payload, body) => { for (const listener of listeners.get(event) ?? []) listener(payload, body); },
    gap: (event) => gaps.get(event)?.(),
    query: async (operation, payload) => { calls.push(["query", operation, payload]); return answers[operation]; },
    queryWithBody: async () => { throw new Error("unused"); },
    command: async (operation, payload) => { calls.push(["command", operation, payload]); return {}; },
    commandWithBody: async (operation, payload, body) => { calls.push(["commandWithBody", operation, payload, text(body)]); return {}; },
    subscribe: add,
    subscribeWithBody: (event, listener, onGap) => { gaps.set(event, onGap); return add(event, listener); },
  };
}

const session = { terminalSessionId: "session-a" };
const position = { windowId: "win_1", terminalSessionId: "session-a", contentRevision: 3, epoch: 2, seq: 0, kind: "snapshot" };

test("the mirror's capability, operation, and event names match the server's", () => {
  assert.equal(APP_WINDOW_MIRROR_CAPABILITY, "app-window-mirror.v1");
  assert.equal(APP_WINDOW_OPERATIONS.mirrorPublish, "app-windows.mirror.publish");
  assert.equal(APP_WINDOW_OPERATIONS.mirrorStatus, "app-windows.mirror.status");
  assert.equal(APP_WINDOW_EVENTS.mirrorData, "app-windows.mirror.data");
  assert.equal(APP_WINDOW_EVENTS.mirrorWanted, "app-windows.mirror.wanted");
});

test("watching, unwatching, and resyncing name the terminal, and status is a boolean", async () => {
  const wire = transport({ [APP_WINDOW_OPERATIONS.mirrorStatus]: { terminalSessionId: "session-a", wanted: true } });
  const client = new AppWindowClient(wire);
  await client.watchMirror("session-a");
  await client.resyncMirror("session-a");
  await client.unwatchMirror("session-a");
  assert.equal(await client.mirrorWanted("session-a"), true);
  assert.deepEqual(wire.calls, [
    ["command", APP_WINDOW_OPERATIONS.mirrorWatch, session],
    ["command", APP_WINDOW_OPERATIONS.mirrorResync, session],
    ["command", APP_WINDOW_OPERATIONS.mirrorUnwatch, session],
    ["query", APP_WINDOW_OPERATIONS.mirrorStatus, session],
  ]);
  await assert.rejects(client.watchMirror("not an id"), TypeError);
  await assert.rejects(new AppWindowClient(transport({ [APP_WINDOW_OPERATIONS.mirrorStatus]: { wanted: "yes" } })).mirrorWanted("session-a"), TypeError);
});

test("a batch is published as bytes, with only its position in the envelope", async () => {
  const wire = transport();
  const client = new AppWindowClient(wire);
  await client.publishMirror("win_1", { epoch: 2, seq: 0, kind: "snapshot", data: "[\"é\"]" });
  await client.publishMirror("win_1", { epoch: 2, seq: 1, kind: "unavailable", data: "[]", reason: "too-busy" });
  assert.deepEqual(wire.calls, [
    ["commandWithBody", APP_WINDOW_OPERATIONS.mirrorPublish, { windowId: "win_1", epoch: 2, seq: 0, kind: "snapshot" }, "[\"é\"]"],
    ["commandWithBody", APP_WINDOW_OPERATIONS.mirrorPublish, { windowId: "win_1", epoch: 2, seq: 1, kind: "unavailable", reason: "too-busy" }, "[]"],
  ]);
});

test("a batch that is malformed or over the limit is not sent", async () => {
  const wire = transport();
  const client = new AppWindowClient(wire);
  for (const bad of [
    { epoch: 1, seq: 0, kind: "video", data: "[]" },
    { epoch: -1, seq: 0, kind: "snapshot", data: "[]" },
    { epoch: 1, seq: 0.5, kind: "snapshot", data: "[]" },
    { epoch: 1, seq: 0, kind: "snapshot", data: 7 },
    { epoch: 1, seq: 0, kind: "snapshot", data: "[]", reason: "because" },
    { epoch: 1, seq: 0, kind: "snapshot", data: "x".repeat(MAX_APP_WINDOW_MIRROR_SNAPSHOT_BYTES + 1) },
    { epoch: 1, seq: 1, kind: "events", data: "x".repeat(MAX_APP_WINDOW_MIRROR_BATCH_BYTES + 1) },
    { epoch: 1, seq: 1, kind: "events", data: "é".repeat(MAX_APP_WINDOW_MIRROR_BATCH_BYTES / 2 + 1) },
  ])
    await assert.rejects(client.publishMirror("win_1", bad), TypeError);
  assert.deepEqual(wire.calls, []);
  // Without a transport that carries bytes, the mirror is unavailable rather than silently broken.
  const { commandWithBody, subscribeWithBody, ...plain } = transport();
  await assert.rejects(new AppWindowClient(plain).publishMirror("win_1", { epoch: 1, seq: 0, kind: "snapshot", data: "[]" }), /unavailable/u);
  assert.throws(() => new AppWindowClient(plain).onMirrorData(() => {}), /unavailable/u);
});

test("received batches are decoded and validated; a malformed one is dropped", () => {
  const wire = transport();
  const client = new AppWindowClient(wire);
  const seen = [];
  let gaps = 0;
  const stop = client.onMirrorData((data) => seen.push(data), () => { gaps += 1; });
  wire.emit(APP_WINDOW_EVENTS.mirrorData, position, bytes("[\"snapshot\"]"));
  wire.emit(APP_WINDOW_EVENTS.mirrorData, { ...position, seq: 1, kind: "unavailable", reason: "too-large" }, bytes("[]"));
  for (const bad of [
    { ...position, kind: "video" },
    { ...position, windowId: "not an id" },
    { ...position, contentRevision: "3" },
    { ...position, epoch: -2 },
    "junk",
  ])
    wire.emit(APP_WINDOW_EVENTS.mirrorData, bad, bytes("[]"));
  assert.deepEqual(seen, [
    { epoch: 2, seq: 0, kind: "snapshot", data: "[\"snapshot\"]", windowId: "win_1", terminalSessionId: "session-a", contentRevision: 3 },
    { epoch: 2, seq: 1, kind: "unavailable", data: "[]", reason: "too-large", windowId: "win_1", terminalSessionId: "session-a", contentRevision: 3 },
  ]);
  assert.ok(Object.isFrozen(seen[0]));
  // The connection reporting dropped events reaches the mirror.
  wire.gap(APP_WINDOW_EVENTS.mirrorData);
  assert.equal(gaps, 1);
  stop();
  wire.emit(APP_WINDOW_EVENTS.mirrorData, position, bytes("[]"));
  assert.equal(seen.length, 2);
});

test("the controlling client is told when to record", () => {
  const wire = transport();
  const client = new AppWindowClient(wire);
  const seen = [];
  const stop = client.onMirrorWanted((terminalSessionId, wanted) => seen.push([terminalSessionId, wanted]));
  wire.emit(APP_WINDOW_EVENTS.mirrorWanted, { clientId: "desktop", terminalSessionId: "session-a", wanted: true });
  wire.emit(APP_WINDOW_EVENTS.mirrorWanted, { terminalSessionId: "session-a", wanted: "yes" });
  wire.emit(APP_WINDOW_EVENTS.mirrorWanted, { terminalSessionId: "session-a", wanted: false });
  assert.deepEqual(seen, [["session-a", true], ["session-a", false]]);
  stop();
});
