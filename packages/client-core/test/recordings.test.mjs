import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { createServerCore, RecordingService, ServerRecordingAdapter } from "@terminay/server-core";
import { RecordingsClient, TerminayClient, TerminayClientFacade } from "../dist/index.js";

const item = {
  recordingId: "recording-a",
  sessionId: "session-a",
  serverId: "server-a",
  projectId: "project-a",
  projectName: "Project A",
  projectRoot: "/private/project",
  relativeCastPath: "recording-a.cast",
  title: "Shell",
  note: null,
  color: null,
  emoji: null,
  startedAt: "2026-07-27T10:00:00.000Z",
  endedAt: null,
  durationMs: null,
  exitCode: null,
  signal: null,
  recordingState: "completed",
  capturedInput: false,
  inputPolicy: "none",
  sensitiveInputPolicy: "drop",
  eventCount: 2,
  bytesWritten: 4,
  castSize: 32,
  castAvailable: true,
  cwdLabel: "project",
  shellName: "zsh",
  format: "asciicast",
  formatVersion: 3,
  errorMessage: null,
  // Legacy Desktop adapters once carried host presentation through recording
  // list data. A canonical client accepts an old response but never exposes
  // those fields to a shared renderer.
  cols: 120,
  rows: 40,
  projectTitle: "Old title",
  projectColor: "#ee00aa",
  projectEmoji: "🧪",
  theme: { background: "#000000" },
};

function fakeTransport() {
  const calls = [];
  return {
    calls,
    async query(operation, payload) {
      calls.push(["query", operation, payload]);
      if (operation === "recordings.list") return { items: [item], total: 1, offset: 0, limit: 20 };
      return { recordingId: "recording-a", start: 0, nextOffset: 4, totalSize: 4, content: "cast", eof: true, incompleteTail: false };
    },
    async command(operation, payload) {
      calls.push(["command", operation, payload]);
      if (operation === "recordings.delete") return null;
      if (operation === "recordings.reveal") return { recordingId: "recording-a", available: false, guidance: "Use replay." };
      return { sessionId: "session-a", recordingId: "recording-a", status: "recording", bytesWritten: 0, eventCount: 0, startedAt: null, errorMessage: null };
    },
  };
}

test("recordings client uses canonical operations, caches lists, and strips path fields", async () => {
  const transport = fakeTransport();
  const client = new RecordingsClient(transport);
  const first = await client.list({ projectId: "project-a", limit: 20 });
  const second = await client.list({ projectId: "project-a", limit: 20 });
  assert.deepEqual(first, second);
  assert.equal(first.items[0].recordingId, "recording-a");
  assert.equal("projectRoot" in first.items[0], false);
  assert.equal("relativeCastPath" in first.items[0], false);
  assert.equal("cols" in first.items[0], false);
  assert.equal("rows" in first.items[0], false);
  assert.equal("projectTitle" in first.items[0], false);
  assert.equal("projectColor" in first.items[0], false);
  assert.equal("projectEmoji" in first.items[0], false);
  assert.equal("theme" in first.items[0], false);
  assert.equal(transport.calls.filter(([kind, operation]) => kind === "query" && operation === "recordings.list").length, 1);
  await client.delete("recording-a", { stopFirst: true });
  await client.list({ projectId: "project-a", limit: 20 });
  assert.equal(transport.calls.filter(([kind, operation]) => kind === "query" && operation === "recordings.list").length, 2);
});

test("recordings client bounds replay and mutation payloads and validates state", async () => {
  const transport = fakeTransport();
  const client = new RecordingsClient(transport);
  assert.equal((await client.replay("recording-a", { start: 0, maxBytes: 1024 })).eof, true);
  assert.equal((await client.start("session-a", { projectId: "project-a", captureInput: false })).status, "recording");
  assert.equal((await client.stop("session-a", { projectId: "project-a" })).sessionId, "session-a");
  assert.equal((await client.reveal("recording-a")).available, false);
  await assert.rejects(() => client.replay("recording-a", { maxBytes: 1024 * 1024 + 1 }), /size/);
  await assert.rejects(() => client.start("session-a\0bad"), /sessionId/);
  await assert.rejects(() => client.list({ limit: 201 }), /limit/);
  assert.deepEqual(transport.calls.slice(0, 4).map(([kind, operation]) => [kind, operation]), [
    ["query", "recordings.replay"],
    ["command", "recordings.start"],
    ["command", "recordings.stop"],
    ["command", "recordings.reveal"],
  ]);
});

test("recording state and timeline run through the framed TerminayClient contract", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-recordings-client-e2e-"));
  const pair = createInMemoryTransportPair();
  const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings"), serverId: "server-e2e" });
  const adapter = new ServerRecordingAdapter(service, { serverId: "server-e2e" });
  const operations = adapter.operations();
  const server = createServerCore({
    serverId: "server-e2e",
    serverVersion: "test",
    capabilities: ["recordings"],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "admin", claims: { projectId: "project-e2e" } }),
    queries: operations.queries,
    commands: operations.commands,
    policies: operations.policies,
  }).accept(pair.server);
  const serverLoop = server.start();
  const client = new TerminayClient({ transport: pair.client, clientId: "client-e2e", capabilities: ["recordings"] });
  try {
    await pair.open();
    await client.connect();
    const recordings = new RecordingsClient(new TerminayClientFacade(client));
    const started = await recordings.start("session-e2e", { projectId: "project-e2e" });
    service.appendOutput("session-e2e", "recorded through the framed client\n");
    const listed = await recordings.list({ projectId: "project-e2e", limit: 20 });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].recordingId, started.recordingId);
    const replay = await recordings.replay(started.recordingId, { maxBytes: 256 * 1024 });
    assert.match(replay.content, /recorded through the framed client/);
    const stopped = await recordings.stop("session-e2e", { projectId: "project-e2e" });
    assert.equal(stopped.status, "idle");
  } finally {
    await client.close().catch(() => undefined);
    await serverLoop.catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  }
});
