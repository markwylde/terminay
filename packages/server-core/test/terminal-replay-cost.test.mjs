import test from "node:test";
import assert from "node:assert/strict";
import { TerminalService } from "../dist/index.js";

/**
 * A repainting TUI delivers its output as hundreds of small PTY callbacks a
 * second. Retaining one of them must cost the same whether the bounded replay
 * holds a few hundred chunks or tens of thousands: the replay is bounded in
 * bytes, so the work to keep it bounded cannot grow with how finely those
 * bytes happened to arrive.
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
  // Past the bound, so the measurement is of the steady state a long-lived
  // terminal spends its life in rather than of the first megabyte.
  for (let sent = 0; sent < MAX_REPLAY_BYTES + chunkBytes; sent += chunkBytes) pty.emit(fill);
  return { pty, service };
}

/** Best of several rounds, so one collection pause cannot decide the result. */
function perChunkMicroseconds(pty) {
  const chunk = new Uint8Array(SMALL).fill(0x79);
  let best = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 5; round += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < MEASURED_CHUNKS; index += 1) pty.emit(chunk);
    best = Math.min(best, ((performance.now() - startedAt) * 1000) / MEASURED_CHUNKS);
  }
  return best;
}

test("retaining an output chunk costs the same however many chunks the replay holds", async (t) => {
  const few = await fullReplay(LARGE);
  const many = await fullReplay(SMALL);
  t.after(() => Promise.all([few.service.shutdown(), many.service.shutdown()]));

  // Same bytes retained, same chunk appended; only the number of retained
  // chunks differs (hundreds against tens of thousands).
  const withFewChunks = perChunkMicroseconds(few.pty);
  const withManyChunks = perChunkMicroseconds(many.pty);

  assert.ok(
    withManyChunks <= withFewChunks * 4,
    `a chunk cost ${withManyChunks.toFixed(1)}µs with a finely-chunked replay against ` +
      `${withFewChunks.toFixed(1)}µs with a coarse one; retention must not scale with the chunk count`,
  );
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
