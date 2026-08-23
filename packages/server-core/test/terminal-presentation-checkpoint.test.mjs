import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  TerminalPresentationCheckpointAuthority,
  TerminalPresentationCheckpointError,
  TerminalService,
} from "../dist/index.js";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

const encoder = new TextEncoder();
const identity = Object.freeze({ serverId: "server-a", projectId: "project-a", sessionId: "session-a" });

function scope(checkpointId, overrides = {}) {
  return { ...identity, clientId: "client-a", attachmentId: "attachment-a", checkpointId, ...overrides };
}

function authority(options = {}) {
  const value = new TerminalPresentationCheckpointAuthority({
    generateCheckpointId: (() => { let id = 0; return () => `checkpoint-${++id}`; })(),
    checkpointIntervalBytes: 1_000_000,
    checkpointIntervalMs: 1_000_000,
    ...options,
  });
  value.createSession(identity, { cols: 20, rows: 5 });
  return value;
}

async function output(value, position, text) {
  await value.ingestOutput(identity, position, encoder.encode(text));
  return position + encoder.encode(text).byteLength;
}

async function outputBytes(value, position, bytes) {
  await value.ingestOutput(identity, position, bytes);
  return position + bytes.byteLength;
}

function restore() {
  const terminal = new Terminal({ cols: 20, rows: 5, scrollback: 1_000, allowProposedApi: true });
  const serialize = new SerializeAddon();
  terminal.loadAddon(serialize);
  return { terminal, serialize };
}

function write(terminal, bytes) {
  return new Promise((resolve) => terminal.write(bytes, resolve));
}

/**
 * xterm 6.1 serialize can encode equivalent default SGR as either `0` or
 * `39;22;24` after OSC 8 cells. Presentation recovery is still correct when
 * replaying both strings yields the same buffer text and cursor.
 */
async function screenSignature(serialized) {
  const session = restore();
  await write(session.terminal, serialized);
  const buffer = session.terminal.buffer.active;
  const lines = [];
  for (let row = 0; row < session.terminal.rows; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
  }
  const signature = {
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    lines,
  };
  session.terminal.dispose();
  return signature;
}

test("checkpoints serialize alternate screen and terminal modes at a safe raw boundary", async () => {
  const value = authority();
  const text = "\x1b[?2004h\x1b[?1004h\x1b[?1049hALT";
  await output(value, 0, text);
  const prepared = await value.prepare(identity, { clientId: "client-a" });
  assert.equal(prepared.position, encoder.encode(text).byteLength);
  assert.equal(prepared.position, prepared.headPosition);
  const metadata = value.bind(prepared.checkpointId, scope(prepared.checkpointId));
  const checkpoint = value.fetch(scope(metadata.checkpointId));
  assert.equal(checkpoint.tail.length, 0);
  const hydrated = restore(checkpoint);
  await write(hydrated.terminal, checkpoint.state);
  const roundTrip = hydrated.serialize.serialize();
  assert.equal(roundTrip.includes("\x1b[?1049h"), true);
  assert.equal(roundTrip.includes("\x1b[?2004h"), true);
  assert.match(roundTrip, /ALT/u);
  hydrated.terminal.dispose();
});

test("an incomplete CSI is never serialized: safe state plus raw tail continues correctly", async () => {
  const value = authority();
  let position = await output(value, 0, "A");
  const safe = await value.prepare(identity, { clientId: "client-a" });
  value.bind(safe.checkpointId, scope(safe.checkpointId));
  value.release(safe.checkpointId, scope(safe.checkpointId));
  position = await output(value, position, "\x1b[");
  const partial = await value.prepare(identity, { clientId: "client-a" });
  assert.equal(partial.position, 1);
  assert.equal(partial.headPosition, 3);
  value.bind(partial.checkpointId, scope(partial.checkpointId));
  const checkpoint = value.fetch(scope(partial.checkpointId));
  assert.equal(checkpoint.tail.length, 1);
  assert.deepEqual([...checkpoint.tail[0].bytes], [...encoder.encode("\x1b[")]);
  const hydrated = restore(checkpoint);
  await write(hydrated.terminal, checkpoint.state);
  for (const event of checkpoint.tail) if (event.type === "output") await write(hydrated.terminal, event.bytes);
  await write(hydrated.terminal, encoder.encode("31mX"));
  assert.equal(hydrated.terminal.buffer.active.getLine(0).translateToString(false).trimEnd(), "AX");
  hydrated.terminal.dispose();
});

test("checkpoint recovery is equivalent at every UTF-8 and VT byte boundary", async () => {
  const bytes = encoder.encode(
    "before αβγ\x1b[2;3H\x1b[1;4;31mstyle\x1b[0m" +
      "\x1b]8;;https://example.test\x07link\x1b]8;;\x07" +
      "\x1bP$qm\x1b\\" +
      "\x1b[?2004h\x1b[?1004h\x1b[?1000h\x1b[?2026hSYNC\x1b[?2026l" +
      "\x1b[?1049halt\x1b[?1049lafter",
  );
  const canonical = restore();
  await write(canonical.terminal, bytes);
  const expected = canonical.serialize.serialize();
  const expectedScreen = await screenSignature(expected);
  canonical.terminal.dispose();

  for (let boundary = 0; boundary <= bytes.byteLength; boundary += 1) {
    const value = authority();
    if (boundary > 0) await outputBytes(value, 0, bytes.slice(0, boundary));
    const prepared = await value.prepare(identity, { clientId: "client-a" });
    value.bind(prepared.checkpointId, scope(prepared.checkpointId));
    const checkpoint = value.fetch(scope(prepared.checkpointId));
    const hydrated = restore();
    await write(hydrated.terminal, checkpoint.state);
    for (const event of checkpoint.tail) {
      if (event.type === "output") await write(hydrated.terminal, event.bytes);
    }
    await write(hydrated.terminal, bytes.slice(prepared.headPosition));
    assert.deepEqual(
      await screenSignature(hydrated.serialize.serialize()),
      expectedScreen,
      `checkpoint differs at byte ${boundary}`,
    );
    hydrated.terminal.dispose();
    value.close();
  }
});

test("checkpoint tails preserve resize transitions in exact output order", async () => {
  const value = authority();
  await output(value, 0, "\x1b[");
  await value.ingestResize(identity, { cols: 30, rows: 7 });
  const prepared = await value.prepare(identity, { clientId: "client-a" });
  value.bind(prepared.checkpointId, scope(prepared.checkpointId));
  const checkpoint = value.fetch(scope(prepared.checkpointId));
  assert.equal(checkpoint.position, 0);
  assert.equal(checkpoint.headPosition, 2);
  assert.deepEqual(checkpoint.tail.map((event) => event.type), ["output", "resize"]);
  assert.deepEqual(checkpoint.tail[1].dimensions, { cols: 30, rows: 7 });
});

test("pins are attachment scoped, one-time, and expire without changing canonical state", async () => {
  let now = 100;
  const value = authority({ now: () => now, maxPinLifetimeMs: 10 });
  await output(value, 0, "ready");
  const prepared = await value.prepare(identity, { clientId: "client-a" });
  assert.throws(
    () => value.bind(prepared.checkpointId, scope(prepared.checkpointId, { clientId: "client-b" })),
    (cause) => cause instanceof TerminalPresentationCheckpointError && cause.code === "checkpoint_forbidden",
  );
  value.bind(prepared.checkpointId, scope(prepared.checkpointId));
  value.fetch(scope(prepared.checkpointId));
  assert.throws(
    () => value.fetch(scope(prepared.checkpointId)),
    (cause) => cause instanceof TerminalPresentationCheckpointError && cause.code === "checkpoint_consumed",
  );
  const next = await value.prepare(identity, { clientId: "client-a" });
  value.bind(next.checkpointId, scope(next.checkpointId));
  now += 10;
  assert.throws(
    () => value.fetch(scope(next.checkpointId)),
    (cause) => cause instanceof TerminalPresentationCheckpointError && cause.code === "checkpoint_expired",
  );
  assert.equal(value.session(identity).outputPosition, 5);
});

test("parser backlog and oversized serialized tails fail fresh recovery without touching PTY input", async () => {
  const value = authority({ maxTailBytes: 2, maxQueuedBytes: 64 });
  await output(value, 0, "\x1b[");
  await output(value, 2, "123");
  await assert.rejects(
    () => value.prepare(identity, { clientId: "client-a" }),
    (cause) => cause instanceof TerminalPresentationCheckpointError && cause.code === "checkpoint_unavailable",
  );

  const processes = [];
  const serviceCheckpoints = authority();
  const service = new TerminalService({
    serverId: "server-a",
    presentationCheckpoints: serviceCheckpoints,
    ptyFactory: { spawn() {
      const data = new Set(); const exit = new Set();
      const process = {
        writes: [], write(bytes) { this.writes.push(new Uint8Array(bytes)); }, resize() {}, kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exit.add(listener); return () => exit.delete(listener); },
        emit(value) { for (const listener of data) listener(encoder.encode(value)); },
      };
      processes.push(process); return process;
    } },
  });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 20, rows: 5 });
  const subscription = service.subscribe(session.identity);
  processes[0].emit("\x1b[6n\x1b[c\x1b]10;?\x07");
  assert.equal(subscription.drain().filter((event) => event.type === "output").length, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(processes[0].writes.length, 0);
  await service.shutdown();
  assert.equal(session.status, "interrupted");
});

test("multi-million-byte output keeps checkpoint time, heap, tail, and pins bounded", async () => {
  const value = authority({ checkpointIntervalBytes: 64 * 1024 });
  const chunk = new Uint8Array(64 * 1024).fill(0x78);
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  let position = 0;
  for (let index = 0; index < 80; index += 1) {
    position = await outputBytes(value, position, chunk);
  }
  const elapsedMs = performance.now() - startedAt;
  const snapshot = value.session(identity);
  assert.equal(position, 5 * 1024 * 1024);
  assert.ok(elapsedMs < 10_000, `checkpoint processing took ${elapsedMs}ms`);
  assert.ok(process.memoryUsage().heapUsed - heapBefore < 64 * 1024 * 1024);
  assert.ok(snapshot.tailBytes <= value.limits.maxTailBytes);
  assert.ok(snapshot.queuedBytes <= value.limits.maxQueuedBytes);

  const first = await value.prepare(identity, { clientId: "client-a" });
  const second = await value.prepare(identity, { clientId: "client-b" });
  const firstMetadata = value.bind(first.checkpointId, scope(first.checkpointId));
  const secondMetadata = value.bind(second.checkpointId, scope(second.checkpointId, {
    clientId: "client-b",
    attachmentId: "attachment-b",
  }));
  const pinned = value.session(identity);
  assert.ok(firstMetadata.byteLength <= value.limits.maxSnapshotBytes + value.limits.maxTailBytes);
  assert.ok(secondMetadata.byteLength <= value.limits.maxSnapshotBytes + value.limits.maxTailBytes);
  assert.equal(pinned.pins, 2);
  assert.ok(pinned.pinnedBytes <= value.limits.maxPinnedBytesPerSession);
  value.releaseAttachment(scope(first.checkpointId));
  value.releaseAttachment(scope(second.checkpointId, { clientId: "client-b", attachmentId: "attachment-b" }));
  assert.equal(value.session(identity).pins, 0);
  value.close();
});

test("authorities clean up canonical emulator state on terminal exit", async () => {
  const value = authority();
  value.closeSession(identity);
  assert.equal(value.session(identity), undefined);
  assert.throws(
    () => value.ingestOutput(identity, 0, encoder.encode("gone")),
    (cause) => cause instanceof TerminalPresentationCheckpointError && cause.code === "checkpoint_not_found",
  );
});
