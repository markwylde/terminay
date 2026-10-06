import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
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
 */

const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const bytesOf = (value) => new TextEncoder().encode(value);

async function until(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(25);
  }
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
    await delay(50);
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return dataRoot;
}

test("a held terminal that repaints continuously is sampled at a bounded rate", async (t) => {
  const dataRoot = dataRootFor(t);
  let samples = 0;
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId: "build-a",
    limitMs: 60_000,
    launch: ({ env }) => launchDetachedSessionHolder(process.execPath, [ENTRY], { ...process.env, ...env }),
    // Stands in for the host's `ps` walk and completes at once, so nothing but
    // the server's own pacing separates one sample from the next.
    resolveForegroundProcess: async () => { samples += 1; return "sh"; },
  });
  const service = new TerminalService({ serverId: "srv", ptyFactory: factory });
  t.after(async () => {
    await service.shutdown();
    await factory.endAll();
  });

  await service.createSession({ projectId: "p1", sessionId: "s1", shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });
  let frames = 0;
  let output = "";
  service.subscribe("s1", {
    onEvent: (event) => {
      if (event.type !== "output") return;
      frames += 1;
      output = (output + new TextDecoder().decode(event.bytes)).slice(-256);
    },
  });
  await service.write("s1", bytesOf("while :; do printf '\\033[H\\033[2Jrepaint-%s\\n' $((1+1)); sleep 0.005; done\n"));
  await until(() => output.includes("repaint-2"), "the repaint loop");

  const framesBefore = frames;
  const samplesBefore = samples;
  const startedAt = performance.now();
  await delay(2_000);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const observedFrames = frames - framesBefore;
  const observedSamples = samples - samplesBefore;

  assert.ok(observedFrames > 100, `the loop only produced ${observedFrames} frames; nothing was measured`);
  const allowed = 2 + Math.ceil(elapsedSeconds * 4);
  assert.ok(
    observedSamples <= allowed,
    `${observedSamples} host samples for ${observedFrames} frames in ${elapsedSeconds.toFixed(1)}s; at most ${allowed} are allowed`,
  );
});
