import assert from "node:assert/strict";
import test from "node:test";
import { RecordingsClient } from "../dist/index.js";

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
