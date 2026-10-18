import test from "node:test";
import assert from "node:assert/strict";
import { BoundedChunkQueue, TerminalService } from "../dist/index.js";

/**
 * A repainting TUI delivers its output as hundreds of small PTY callbacks a
 * second. Retaining one of them must cost the same whether the bounded replay
 * holds a few hundred chunks or tens of thousands: the replay is bounded in
 * bytes, so the work to keep it bounded cannot grow with how finely those
 * bytes happened to arrive.
 *
 * The cost is counted, not timed: every chunk records each time its bytes are
 * read, and keeping the bound by re-summing what is retained would read every
 * retained chunk on every append.
 */

const MAX_REPLAY_BYTES = 1024 * 1024;
const SMALL = 16;
const LARGE = 4096;
const MEASURED_CHUNKS = 2_000;

function createPty() {
  const listeners = new Set();
  return {
    pid: 9100,
    write() {},
    resize() {},
    kill() {},
    onData(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onExit() { return () => {}; },
    emit(bytes) { for (const listener of listeners) listener(bytes); },
  };
}

async function fullReplay(chunkBytes) {
  const pty = createPty();
  const service = new TerminalService({
    serverId: "replay-cost",
    ptyFactory: { spawn: () => pty },
    maxReplayBytes: MAX_REPLAY_BYTES,
  });
  await service.createSession({ projectId: "p1", sessionId: "s1", shellPath: "/bin/sh", cols: 80, rows: 24 });
  const fill = new Uint8Array(chunkBytes).fill(0x78);
  // Past the bound, so what follows is the steady state a long-lived
  // terminal spends its life in rather than the first megabyte.
  for (let sent = 0; sent < MAX_REPLAY_BYTES + chunkBytes; sent += chunkBytes) pty.emit(fill);
  return { pty, service };
}

/** A queue past its bound, made of chunks that count every read of their bytes. */
function countingQueue(chunkBytes) {
  const queue = new BoundedChunkQueue(MAX_REPLAY_BYTES, "within-bound");
  const reads = { count: 0 };
  const chunk = (size) => {
    const bytes = new Uint8Array(size);
    return { get bytes() { reads.count += 1; return bytes; } };
  };
  for (let held = 0; held < MAX_REPLAY_BYTES + chunkBytes; held += chunkBytes) queue.push(chunk(chunkBytes));
  return {
    queue,
    /** Reads of retained bytes per appended small chunk. */
    readsPerAppend() {
      reads.count = 0;
      for (let index = 0; index < MEASURED_CHUNKS; index += 1) queue.push(chunk(SMALL));
      return reads.count / MEASURED_CHUNKS;
    },
  };
}

test("retaining an output chunk costs the same however many chunks the replay holds", () => {
  // Same bytes retained, same chunk appended; only the number of retained
  // chunks differs (hundreds against tens of thousands).
  const few = countingQueue(LARGE);
  const many = countingQueue(SMALL);
  assert.ok(few.queue.length < 300 && many.queue.length > 60_000);

  const withFewChunks = few.readsPerAppend();
  const withManyChunks = many.readsPerAppend();
  // An append reads its own chunk and whichever chunks it evicts: a handful,
  // never a share of what is retained.
  assert.ok(
    withManyChunks <= 8 && withFewChunks <= 8,
    `an append read ${withManyChunks} chunks with a finely-chunked replay and ${withFewChunks} with a coarse one; ` +
      "retention must not scale with the chunk count",
  );
});

test("a terminal's replay is held in that bounded queue", async (t) => {
  const { service } = await fullReplay(SMALL);
  t.after(() => service.shutdown());
  // The queue above is what keeps a session's replay; nothing else does.
  const replay = service.sessionsById.get("s1").replay;
  assert.ok(replay instanceof BoundedChunkQueue);
  assert.equal(replay.maxBytes, MAX_REPLAY_BYTES);
});

test("the replay stays bounded and contiguous while small chunks displace old ones", async (t) => {
  const { pty, service } = await fullReplay(SMALL);
  t.after(() => service.shutdown());
  const marker = new TextEncoder().encode("0123456789abcdef");
  for (let index = 0; index < 1_000; index += 1) pty.emit(marker);

  const session = service.getSession("s1");
  const retained = session.outputPosition - session.replayFrom;
  assert.ok(retained <= MAX_REPLAY_BYTES, `retained ${retained} bytes`);
  assert.ok(retained > MAX_REPLAY_BYTES - SMALL, "the replay dropped more than it had to");

  // Everything still retained is delivered, in order, from the reported start.
  let next = session.replayFrom;
  let tail = "";
  const subscription = service.subscribe("s1", {
    fromPosition: session.replayFrom,
    onEvent: (event) => {
      if (event.type !== "output") return;
      assert.equal(event.position, next, "replay skipped or repeated bytes");
      next += event.bytes.byteLength;
      tail = (tail + new TextDecoder().decode(event.bytes)).slice(-marker.byteLength);
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  subscription.unsubscribe?.();
  assert.equal(next, session.outputPosition);
  assert.equal(tail, "0123456789abcdef");
});
