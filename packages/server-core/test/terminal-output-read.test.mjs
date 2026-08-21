import assert from "node:assert/strict";
import test from "node:test";
import {
  TerminalPresentationCheckpointAuthority,
  TerminalService,
  TerminalServiceError,
} from "../dist/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn() {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        write() {}, resize() {}, kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emit(value) {
          const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
          for (const listener of dataListeners) listener(bytes);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

async function fixture(options = {}) {
  const pty = createPtyFactory();
  const checkpoints = options.presentation === false ? undefined : new TerminalPresentationCheckpointAuthority({
    maxScrollback: 64,
    checkpointIntervalBytes: 1_000_000,
    checkpointIntervalMs: 1_000_000,
    ...(options.checkpointOptions ?? {}),
  });
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    ...(checkpoints === undefined ? {} : { presentationCheckpoints: checkpoints }),
    ...(options.serviceOptions ?? {}),
  });
  const handle = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: options.cols ?? 10, rows: options.rows ?? 4 });
  const authorization = { serverId: "server-a", projectId: "project-a", sessionId: "session-a", scope: "read" };
  return { pty, service, handle, authorization };
}

test("retained output reads exact byte pages and cursor metadata", async () => {
  const { pty, service, handle, authorization } = await fixture();
  const bytes = encoder.encode("A\x1b[31mπ\x1b[0mB");
  pty.processes[0].emit(bytes);
  const first = service.readRetainedOutput(handle.snapshot(), { authorization, fromPosition: 0, maxBytes: 4 });
  assert.deepEqual([...first.bytes], [...bytes.slice(0, 4)]);
  assert.deepEqual({ from: first.fromPosition, next: first.nextPosition, head: first.outputPosition, more: first.hasMore }, { from: 0, next: 4, head: bytes.byteLength, more: true });
  const second = service.readRetainedOutput(handle.snapshot(), { authorization, fromPosition: first.nextPosition, maxBytes: 64 });
  assert.deepEqual([...second.bytes], [...bytes.slice(4)]);
  assert.equal(second.nextPosition, bytes.byteLength);
  assert.equal(second.hasMore, false);
  await service.shutdown();
});

test("retained output reports ring history loss without rejecting a resyncing cursor", async () => {
  const { pty, service, handle, authorization } = await fixture({ serviceOptions: { maxReplayBytes: 8 } });
  pty.processes[0].emit("first");
  pty.processes[0].emit("second");
  const read = service.readRetainedOutput(handle.snapshot(), { authorization, fromPosition: 0, maxBytes: 8 });
  assert.deepEqual({ text: decoder.decode(read.bytes), from: read.fromPosition, next: read.nextPosition, replayFrom: read.replayFrom, historyLost: read.historyLost, dropped: read.droppedBytes }, {
    text: "second", from: 5, next: 11, replayFrom: 5, historyLost: true, dropped: 5,
  });
  await service.shutdown();
});

test("retained output rejects impossible cursors and invalid payload bounds", async () => {
  const { pty, service, handle, authorization } = await fixture({ serviceOptions: { maxReplayBytes: 8 } });
  pty.processes[0].emit("abc");
  assert.throws(() => service.readRetainedOutput(handle.snapshot(), { authorization, fromPosition: 4, maxBytes: 1 }), (error) => error instanceof TerminalServiceError && error.code === "invalid_position");
  assert.throws(() => service.readRetainedOutput(handle.snapshot(), { authorization, maxBytes: 0 }), (error) => error instanceof TerminalServiceError && error.code === "invalid_bytes");
  assert.throws(() => service.readRetainedOutput(handle.snapshot(), { authorization, maxBytes: 9 }), (error) => error instanceof TerminalServiceError && error.code === "invalid_bytes");
  await service.shutdown();
});

test("presentation text emulates ANSI controls, wrapping, and trimmed padding", async () => {
  const { pty, service, handle, authorization } = await fixture({ cols: 5, rows: 3 });
  pty.processes[0].emit("\x1b[31mabcde\x1b[0mfghij\rX  ");
  const read = await service.readPresentation(handle.snapshot(), { authorization, format: "text", maxBytes: 128, maxRows: 3 });
  assert.equal(read.format, "text");
  assert.deepEqual(read.dimensions, { cols: 5, rows: 3 });
  assert.deepEqual(read.rows, ["abcde", "X  ij"]);
  assert.equal(read.rows.some((row) => row.includes("\x1b")), false);
  assert.equal(read.rows[1].endsWith("  "), false, "xterm padding must not become agent context");
  await service.shutdown();
});

test("presentation preserves split UTF-8 decoding across PTY chunks", async () => {
  const { pty, service, handle, authorization } = await fixture();
  const bytes = encoder.encode("αβγ");
  for (let index = 0; index < bytes.byteLength; index += 1) pty.processes[0].emit(bytes.slice(index, index + 1));
  const read = await service.readPresentation(handle.snapshot(), { authorization, maxBytes: 128, maxRows: 1 });
  assert.deepEqual(read.rows, ["αβγ"]);
  assert.equal(read.position, bytes.byteLength);
  await service.shutdown();
});

test("presentation text applies row and UTF-8 payload bounds from the newest visual rows", async () => {
  const { pty, service, handle, authorization } = await fixture({ cols: 6, rows: 3 });
  pty.processes[0].emit("one\r\ntwo\r\nαβγ");
  const rows = await service.readPresentation(handle.snapshot(), { authorization, maxBytes: 3, maxRows: 2 });
  assert.deepEqual(rows.rows, ["α"]);
  assert.equal(rows.truncated, true);
  assert.equal(rows.droppedRows > 0, true);
  assert.equal(rows.droppedBytes > 0, true);
  await service.shutdown();
});

test("presentation ANSI serializes bounded canonical scrollback and remains byte bounded", async () => {
  const { pty, service, handle, authorization } = await fixture({ cols: 20, rows: 2 });
  pty.processes[0].emit("\x1b[31mred\x1b[0m\r\nolder\r\nnewest");
  const full = await service.readPresentation(handle.snapshot(), { authorization, format: "ansi", maxBytes: 4_096 });
  assert.match(full.ansi, /red/u);
  assert.ok(full.ansi.includes(`${String.fromCharCode(27)}[31m`));
  assert.deepEqual(full.dimensions, { cols: 20, rows: 2 });
  assert.match(full.ansi, /older/u, "the default ANSI read retains configured scrollback");
  const bounded = await service.readPresentation(handle.snapshot(), { authorization, format: "ansi", maxBytes: 4 });
  assert.equal(encoder.encode(bounded.ansi).byteLength <= 4, true);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.droppedBytes > 0, true);
  await service.shutdown();
});

test("presentation reads fail explicitly when no canonical emulator is composed", async () => {
  const { service, handle, authorization } = await fixture({ presentation: false });
  assert.throws(
    () => service.readPresentation(handle.snapshot(), { authorization, maxBytes: 64 }),
    (error) => error instanceof TerminalServiceError && error.code === "presentation_unavailable",
  );
  await service.shutdown();
});
