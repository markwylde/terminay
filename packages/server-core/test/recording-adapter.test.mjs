import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RECORDING_OPERATIONS,
  RecordingService,
  RecordingServiceError,
  ServerRecordingAdapter,
} from "../dist/index.js";

const auth = (scope, projectId) => ({ serverId: "server-a", scope, ...(projectId === undefined ? {} : { projectId }) });

test("recording start resolves the canonical terminal project and rejects forged session scope", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recording-session-scope-"));
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings"), serverId: "server-a" });
    const adapter = new ServerRecordingAdapter(service, {
      serverId: "server-a",
      resolveSessionProject: (sessionId) => sessionId === "session-a" ? "project-a" : undefined,
    });
    assert.throws(
      () => adapter.start({ authorization: auth("write", "project-a"), sessionId: "unknown", projectId: "project-a" }),
      (error) => error instanceof RecordingServiceError && error.code === "not_found",
    );
    assert.throws(
      () => adapter.start({ authorization: auth("admin"), sessionId: "session-a", projectId: "project-b" }),
      (error) => error instanceof RecordingServiceError && error.code === "forbidden",
    );
    assert.equal(adapter.start({
      authorization: auth("write", "project-a"),
      sessionId: "session-a",
      projectId: "project-a",
    }).status, "recording");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("protocol-facing recording adapter keeps capture alive across client loss and bounds opaque replay", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recording-adapter-"));
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings"), serverId: "server-a" });
    let revealedPath;
    const adapter = new ServerRecordingAdapter(service, {
      serverId: "server-a",
      hasHostRevealCapability: (authorization) => authorization.clientId === "host-client",
      revealOnHost: (castPath) => { revealedPath = castPath; },
    });
    const started = adapter.start({ authorization: auth("write", "project-a"), sessionId: "session-a", projectId: "project-a", metadata: { title: "A" } });
    service.appendOutput("session-a", "survives adapter/client disconnect\n");
    const listed = adapter.list({ authorization: auth("read", "project-a"), options: { projectId: "project-a", limit: 10 } });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].recordingId, started.recordingId);
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const replay = adapter.replay({ authorization: auth("read", "project-a"), recordingId: started.recordingId, maxBytes: 256 });
    assert.ok(replay.content.includes("survives adapter"));
    assert.throws(() => adapter.replay({ authorization: { ...auth("read"), serverId: "server-b" }, recordingId: started.recordingId }), (error) => error instanceof RecordingServiceError && error.code === "forbidden");
    const remoteReveal = await adapter.reveal({ authorization: { ...auth("read", "project-a"), clientId: "remote" }, recordingId: started.recordingId });
    assert.equal(remoteReveal.available, false);
    assert.equal("path" in remoteReveal, false);
    const hostReveal = await adapter.reveal({ authorization: { ...auth("read", "project-a"), clientId: "host-client" }, recordingId: started.recordingId });
    assert.equal(hostReveal.available, true);
    assert.equal(typeof revealedPath, "string");
    assert.equal("path" in hostReveal, false);
    assert.throws(() => adapter.delete({ authorization: auth("admin", "project-a"), recordingId: started.recordingId }), (error) => error instanceof RecordingServiceError && error.code === "active_recording");
    adapter.stop({ authorization: auth("write", "project-a"), sessionId: "session-a", projectId: "project-a" });
    adapter.delete({ authorization: auth("admin", "project-a"), recordingId: started.recordingId });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("recording operations expose bounded query/command handlers without filesystem paths", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recording-ops-"));
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings"), serverId: "server-a" });
    const adapter = new ServerRecordingAdapter(service, { serverId: "server-a" });
    const operations = adapter.operations();
    const context = { connectionId: "connection-a", clientId: "client-a", authScope: "write", signal: new AbortController().signal };
    const command = { envelope: { type: "command", commandId: "command-a", correlationId: "correlation-a", operation: RECORDING_OPERATIONS.start, payload: { sessionId: "session-b", projectId: "project-b", metadata: { title: "B" } } }, body: new Uint8Array(), context };
    const started = await operations.commands[RECORDING_OPERATIONS.start](command);
    assert.equal(started.sessionId, "session-b");
    service.appendOutput("session-b", "protocol output\n");
    const list = await operations.queries[RECORDING_OPERATIONS.list]({ envelope: { type: "query", queryId: "query-a", operation: RECORDING_OPERATIONS.list, payload: { projectId: "project-b", limit: 1 } }, body: new Uint8Array(), context: { ...context, authScope: "read" } });
    assert.equal(list.items.length, 1);
    assert.equal("relativeCastPath" in list.items[0], false);
    assert.equal(JSON.stringify(list).includes("recordings/"), false);
    assert.equal(JSON.stringify(list).includes(home), false);
    await operations.commands[RECORDING_OPERATIONS.stop]({ envelope: { type: "command", commandId: "command-b", correlationId: "correlation-b", operation: RECORDING_OPERATIONS.stop, payload: { sessionId: "session-b", projectId: "project-b" } }, body: new Uint8Array(), context });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("reloaded protocol observers reuse one server capture without duplicate cast events", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recording-adapter-observers-"));
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings"), serverId: "server-a" });
    const adapter = new ServerRecordingAdapter(service, { serverId: "server-a" });
    const statesA = [];
    const statesB = [];
    const removeA = service.subscribe((state) => statesA.push(state));
    const removeB = service.subscribe((state) => statesB.push(state));
    const started = adapter.start({ authorization: auth("write"), sessionId: "observer-session", metadata: { title: "Observer" } });
    service.appendOutput("observer-session", "event-before-reload\n");
    const firstView = adapter.list({ authorization: auth("read"), options: { limit: 10 } });
    assert.equal(firstView.items[0].recordingId, started.recordingId);
    removeA();
    service.appendOutput("observer-session", "event-after-reload\n");
    const secondView = adapter.list({ authorization: auth("read"), options: { limit: 10 } });
    assert.equal(secondView.items[0].eventCount, 2);
    removeB();
    adapter.stop({ authorization: auth("write"), sessionId: "observer-session" });
    const replay = adapter.replay({ authorization: auth("read"), recordingId: started.recordingId, maxBytes: 256 * 1024 });
    assert.equal(replay.content.split("\n").filter((line) => line.includes('"o"')).length, 2);
    assert.equal(statesA.length >= 2, true);
    assert.equal(statesB.length >= 3, true);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("concurrent stop commands are idempotent and finalize one cast", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recording-adapter-stop-"));
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings"), serverId: "server-a" });
    const adapter = new ServerRecordingAdapter(service, { serverId: "server-a" });
    const authorization = auth("write");
    adapter.start({ authorization, sessionId: "concurrent-stop" });
    service.appendOutput("concurrent-stop", "one event\n");
    const states = await Promise.all([
      Promise.resolve().then(() => adapter.stop({ authorization, sessionId: "concurrent-stop" })),
      Promise.resolve().then(() => adapter.stop({ authorization, sessionId: "concurrent-stop" })),
    ]);
    assert.deepEqual(states.map((state) => state.status), ["idle", "idle"]);
    const [item] = service.listRecordings();
    assert.equal(item.recordingState, "completed");
    assert.equal(item.eventCount, 1);
  } finally { await rm(home, { recursive: true, force: true }); }
});
