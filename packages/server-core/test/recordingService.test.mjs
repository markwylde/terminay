import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_RECORDING_CHUNK_BYTES,
  RecordingService,
  RecordingServiceError,
} from "../dist/index.js";

async function filesUnder(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  await walk(root);
  return files;
}

function pathFree(value) {
  const encoded = JSON.stringify(value);
  assert.doesNotMatch(encoded, /castPath|metadataPath/);
  assert.doesNotMatch(encoded, /\/var\/|\/tmp\/|\/Users\//);
}

test("capture is server-owned, output is written once, and input is opt-in", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-server-recording-"));
  const root = join(home, "recordings");
  try {
    let clock = Date.parse("2026-07-27T12:00:00Z");
    const service = new RecordingService({ homeDirectory: home, recordingRoot: root, now: () => new Date(clock) });
    const started = service.start("session-1", { title: "Shell", cwd: join(home, "project"), shell: "/bin/zsh" });
    service.appendOutput("session-1", "hello\r\n");
    service.appendInput("session-1", "secret-not-recorded");
    service.setInputCapture("session-1", true);
    service.appendInput("session-1", "captured");
    clock += 50;
    service.finalize("session-1", 0);
    const [item] = service.listRecordings();
    assert.equal(item.recordingId, started.recordingId);
    assert.equal(item.capturedInput, true);
    assert.equal(item.recordingState, "completed");
    pathFree(item);
    const castPath = (await filesUnder(root)).find((file) => file.endsWith(".cast"));
    const cast = await readFile(castPath, "utf8");
    assert.equal(cast.split("\n").filter((line) => line.includes("hello")).length, 1);
    assert.equal(cast.includes("secret-not-recorded"), false);
    assert.equal(cast.includes("captured"), true);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("capture survives observer disconnects and view metadata changes without leaking private values", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-server-recording-observers-"));
  const root = join(home, "recordings");
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: root, serverId: "server-a" });
    const firstObserver = [];
    const secondObserver = [];
    const removeFirst = service.subscribe((state) => firstObserver.push(state));
    const removeSecond = service.subscribe((state) => secondObserver.push(state));
    const started = service.start("no-client-capture", {
      projectId: "project-a",
      projectName: "Project A",
      projectRoot: join(home, "private-project"),
      title: "Initial view",
      environment: { TERM: "xterm-256color", SECRET_VALUE: "do-not-store" },
    });
    service.appendOutput("no-client-capture", "before disconnect\n");
    removeFirst();
    service.updateSessionMetadata("no-client-capture", { title: "Moved view", projectRoot: join(home, "moved-private-project") });
    service.appendOutput("no-client-capture", "after disconnect\n");
    assert.equal(service.activeCount, 1);
    removeSecond();
    service.appendOutput("no-client-capture", "without observers\n");
    service.finalize("no-client-capture");

    const [item] = service.listRecordings();
    assert.equal(item.recordingId, started.recordingId);
    assert.equal(item.title, "Moved view");
    assert.equal(item.eventCount, 3);
    assert.equal(firstObserver.length >= 2, true);
    assert.equal(secondObserver.length >= 3, true);
    assert.equal(JSON.stringify(item).includes(home), false);
    const castPath = (await filesUnder(root)).find((file) => file.endsWith(".cast"));
    const cast = await readFile(castPath, "utf8");
    assert.equal(cast.includes("before disconnect"), true);
    assert.equal(cast.includes("after disconnect"), true);
    assert.equal(cast.includes("without observers"), true);
    assert.equal(cast.includes("SECRET_VALUE"), false);
    assert.equal(cast.includes("do-not-store"), false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("shutdown interruption is visible to the next server instance and does not duplicate events", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-server-recording-restart-"));
  const root = join(home, "recordings");
  try {
    const first = new RecordingService({ homeDirectory: home, recordingRoot: root });
    const started = first.start("restart-session");
    first.appendOutput("restart-session", "one event\n");
    first.shutdown();
    assert.equal(first.activeCount, 0);
    const restarted = new RecordingService({ homeDirectory: home, recordingRoot: root });
    const [item] = restarted.listRecordings();
    assert.equal(item.recordingId, started.recordingId);
    assert.equal(item.recordingState, "interrupted");
    const replay = restarted.readRecordingChunk({ recordingId: started.recordingId, start: 0 });
    assert.equal(replay.content.split("\n").filter((line) => line.includes('"o"')).length, 1);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("large replay is bounded to complete NDJSON records and cancellation is honored", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-server-recording-chunk-"));
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings") });
    service.start("large");
    service.appendOutput("large", "x".repeat(1_000_000));
    service.finalize("large");
    const [item] = service.listRecordings();
    let cursor = 0;
    let content = "";
    for (;;) {
      const chunk = service.readRecordingChunk({ recordingId: item.recordingId, start: cursor, maxBytes: 256 * 1024 });
      content += chunk.content;
      cursor = chunk.nextOffset;
      if (chunk.eof) break;
    }
    assert.ok(content.includes('"version":3'));
    assert.ok(content.includes('"o"'));
    const controller = new AbortController();
    controller.abort();
    assert.throws(() => service.readRecordingChunk({ recordingId: item.recordingId, signal: controller.signal }), (error) => error instanceof RecordingServiceError && error.code === "aborted");
    assert.throws(() => service.readRecordingChunk({ recordingId: item.recordingId, maxBytes: MAX_RECORDING_CHUNK_BYTES + 1 }), /between 1/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("restart recovery marks an unfinalized cast interrupted and deletion remains id-authorized", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-server-recording-recovery-"));
  const root = join(home, "recordings");
  try {
    const first = new RecordingService({ homeDirectory: home, recordingRoot: root });
    const active = first.start("survives-client-disconnect");
    first.appendOutput("survives-client-disconnect", "still alive");
    const restarted = new RecordingService({ homeDirectory: home, recordingRoot: root });
    const [recovered] = restarted.listRecordings();
    assert.equal(recovered.recordingId, active.recordingId);
    assert.equal(recovered.recordingState, "interrupted");
    assert.throws(() => restarted.readRecordingChunk({ recordingId: "../escape" }), (error) => error instanceof RecordingServiceError && error.code === "invalid_id");
    assert.throws(() => first.deleteRecordingById(active.recordingId), /active recording|Stop/);
    first.finalize("survives-client-disconnect");
    restarted.deleteRecordingById(active.recordingId);
    assert.equal(restarted.listRecordings().length, 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("orphan casts remain discoverable with reduced interrupted metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-server-recording-orphan-"));
  const root = join(home, "recordings", "2026-07-27");
  try {
    const recordingId = "00000000-0000-4000-8000-000000000001";
    await (await import("node:fs/promises")).mkdir(root, { recursive: true });
    await writeFile(join(root, `${recordingId}.cast`), `${JSON.stringify({ version: 3, term: { cols: 100, rows: 30 }, timestamp: 1_753_632_000, title: "Old" })}\n`);
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings") });
    const [item] = service.listRecordings();
    assert.equal(item.recordingState, "interrupted");
    assert.equal(item.castAvailable, true);
    assert.equal(item.cols, 100);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("recording timeline supports bounded search, filters, and grouping without absolute paths", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-server-recording-timeline-"));
  try {
    const service = new RecordingService({ homeDirectory: home, recordingRoot: join(home, "recordings") });
    service.start("timeline-a", { title: "Build", projectId: "project-a" });
    service.finalize("timeline-a", 0);
    service.start("timeline-b", { title: "Deploy", projectId: "project-b" });
    service.finalize("timeline-b", 0);
    const filtered = service.list({ search: "build", projectId: "project-a", limit: 1 });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].title, "Build");
    assert.equal(JSON.stringify(filtered.items[0]).includes(home), false);
    const grouped = service.groupRecordings("project", { limit: 10 });
    assert.deepEqual(grouped.map((group) => group.key).sort(), ["project-a", "project-b"]);
  } finally { await rm(home, { recursive: true, force: true }); }
});
