import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionHolderPtyFactory,
  launchDetachedSessionHolder,
  readHolderRecords,
  TerminalService,
} from "../dist/index.js";

/**
 * A real detached holder with a real PTY running a repainting loop, which is
 * what a full-screen TUI looks like from the server: hundreds of small output
 * frames a second for as long as it is on screen. The server's foreground
 * observation walks the host process table, so it has to be paced by time and
 * not by how often the terminal happens to print.
 *
 * The output is real; the time that paces sampling is the test's. Frames are
 * counted as they arrive, and the pacing clock moves only when the test moves
 * it, so the bound holds however fast or slow the machine prints.
 */

const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const bytesOf = (value) => new TextEncoder().encode(value);

/**
 * The pacing clock: `now` for the output ramp, and its timeouts and the poll
 * interval, which fire only as `advance` moves time past them.
 */
function createManualClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const add = (handler, ms, every) => {
    nextId += 1;
    const timer = { id: nextId, at: now + ms, handler, every };
    timers.set(timer.id, timer);
    return timer;
  };
  const remove = (timer) => { timers.delete(timer?.id); };
  return {
    now: () => now,
    schedule: (handler, ms) => add(handler, ms, undefined),
    setInterval: (handler, ms) => add(handler, ms, ms),
    cancel: remove,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.values()]
          .filter((timer) => timer.at <= target)
          .sort((left, right) => left.at - right.at || left.id - right.id)[0];
        if (next === undefined) break;
        now = next.at;
        if (next.every === undefined) timers.delete(next.id);
        else next.at += next.every;
        next.handler();
      }
      now = target;
    },
  };
}

function dataRootFor(t) {
  // realpath keeps the socket path short and stable on macOS, where the
  // temporary directory is reached through a symlink.
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(async () => {
    // Whatever a failed assertion left behind must not outlive the test.
    for (const record of readHolderRecords(dataRoot)) {
      try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return dataRoot;
}

test("a held terminal that repaints continuously is sampled at a bounded rate", async (t) => {
  const dataRoot = dataRootFor(t);
  let samples = 0;
  const clock = createManualClock();
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId: "build-a",
    limitMs: 60_000,
    launch: ({ env }) => launchDetachedSessionHolder(process.execPath, [ENTRY], { ...process.env, ...env }),
    // Stands in for the host's `ps` walk and completes at once, so nothing but
    // the server's own pacing separates one sample from the next.
    resolveForegroundProcess: async () => { samples += 1; return "sh"; },
    foregroundPolling: {
      setInterval: clock.setInterval,
      clearInterval: clock.cancel,
      outputRamp: { now: clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel },
    },
  });
  const service = new TerminalService({ serverId: "srv", ptyFactory: factory });
  t.after(async () => {
    await service.shutdown();
    await factory.endAll();
  });

  await service.createSession({ projectId: "p1", sessionId: "s1", shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });
  let frames = 0;
  let output = "";
  const frameWaiters = new Set();
  /** Settles once `count` more output frames have arrived. */
  const moreFrames = (count) => new Promise((resolve) => frameWaiters.add({ until: frames + count, resolve }));
  let repainting;
  const repainted = new Promise((resolve) => { repainting = resolve; });
  service.subscribe("s1", {
    onEvent: (event) => {
      if (event.type !== "output") return;
      frames += 1;
      output = (output + new TextDecoder().decode(event.bytes)).slice(-256);
      if (output.includes("repaint-2")) repainting();
      for (const waiter of [...frameWaiters]) {
        if (frames < waiter.until) continue;
        frameWaiters.delete(waiter);
        waiter.resolve();
      }
    },
  });
  await service.write("s1", bytesOf("while :; do printf '\\033[H\\033[2Jrepaint-%s\\n' $((1+1)); sleep 0.005; done\n"));
  await repainted;

  // With the pacing clock still, a flood of frames earns no further sample:
  // every one collapses into the single run the ramp is holding.
  const samplesAtRest = samples;
  await moreFrames(200);
  assert.equal(samples, samplesAtRest, `${samples - samplesAtRest} host samples while no time passed`);

  // Two seconds of pacing time, in 100 ms steps, with the loop printing
  // through every step.
  const framesBefore = frames;
  const samplesBefore = samples;
  const elapsedSeconds = 2;
  for (let step = 0; step < elapsedSeconds * 10; step += 1) {
    clock.advance(100);
    await moreFrames(5);
  }
  const observedFrames = frames - framesBefore;
  const observedSamples = samples - samplesBefore;

  assert.ok(observedSamples > 0, "no host sample was taken in two seconds of output");
  const allowed = 2 + Math.ceil(elapsedSeconds * 4);
  assert.ok(
    observedSamples <= allowed,
    `${observedSamples} host samples for ${observedFrames} frames in ${elapsedSeconds}s; at most ${allowed} are allowed`,
  );
});
