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
  TerminalServiceError,
} from "../dist/index.js";

/**
 * These tests run a real detached holder process with a real PTY. "Restarting
 * the server" is modelled exactly as it happens: one TerminalService and
 * factory let go, and a second pair is built from nothing but the data root.
 */

const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const SERVER_ID = "srv";
const text = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (value) => new TextEncoder().encode(value);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

function server(dataRoot, buildId = "build-a", options = {}) {
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId,
    limitMs: 60_000,
    launch: ({ env }) => launchDetachedSessionHolder(process.execPath, [ENTRY], { ...process.env, ...env }),
    ...options,
  });
  const service = new TerminalService({ serverId: SERVER_ID, ptyFactory: factory });
  return { factory, service };
}

/** What a server does when asked to end its terminals. */
async function endEverything({ service, factory }) {
  await service.shutdown();
  await factory.endAll();
}

/** Collect a subscription's output as text. */
function watch(service, sessionId, fromPosition) {
  const state = { output: "", exits: [], firstPosition: undefined };
  const subscription = service.subscribe(sessionId, {
    ...(fromPosition === undefined ? {} : { fromPosition }),
    onEvent: (event) => {
      if (event.type === "output") {
        state.firstPosition ??= event.position;
        state.output += text(event.bytes);
      } else if (event.type === "exit") state.exits.push(event);
    },
  });
  return { state, subscription };
}

async function adoptAll(dataRoot, buildId, options) {
  const next = server(dataRoot, buildId, options);
  const held = await next.factory.start();
  for (const session of held) {
    if (session.exit !== undefined) continue;
    const { process: pty, record, from } = await next.factory.adopt(session.sessionId);
    next.service.adoptSession({
      identity: { serverId: SERVER_ID, projectId: record.projectId, sessionId: record.sessionId },
      cwd: record.cwd,
      createdAt: record.createdAt,
      cols: record.cols,
      rows: record.rows,
      process: pty,
      outputPosition: from,
    });
  }
  return { ...next, held };
}

const create = (service, sessionId, dataRoot) =>
  service.createSession({ projectId: "p1", sessionId, shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });

test("a shell survives its server and is adopted with its output and position intact", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const before = watch(first.service, "s1");
  const pid = first.service.getSession("s1").pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);

  await first.service.write("s1", bytesOf("echo marker-$((40+2))\n"));
  await until(() => before.state.output.includes("marker-42"), "the first command");
  const acknowledged = first.service.getSession("s1").outputPosition;

  // Work that outlives the server: it prints after the server has gone and
  // then keeps a foreground process running.
  await first.service.write("s1", bytesOf("sleep 1; echo while-$((1+1))-away; sleep 30\n"));
  await delay(100);

  await first.service.shutdown({ detach: true });
  await first.factory.detach();
  assert.equal(before.state.exits.length, 0, "detaching published an exit");
  assert.equal(isAlive(pid), true, "the shell died with its server");

  await delay(1_500);

  const second = await adoptAll(dataRoot);
  t.after(() => endEverything(second));
  assert.deepEqual(second.held.map((session) => session.sessionId), ["s1"]);
  const adopted = second.service.getSession("s1");
  assert.equal(adopted.pid, pid);
  assert.equal(adopted.status, "running");
  assert.equal(readHolderRecords(dataRoot).length, 1, "a second holder was started");

  // A client that had acknowledged `acknowledged` receives exactly the rest.
  const after = watch(second.service, "s1", acknowledged);
  await until(() => after.state.output.includes("while-2-away"), "output produced while detached");
  assert.equal(after.state.firstPosition, acknowledged);
  assert.equal(after.state.output.includes("marker-42"), false, "acknowledged output was replayed");

  // A fresh client still gets everything retained.
  const fresh = watch(second.service, "s1", adopted.replayFrom);
  await until(() => fresh.state.output.includes("while-2-away"), "the full replay");
  assert.ok(fresh.state.output.includes("marker-42"));

  // Busy state resumes with no input from anyone.
  const observation = await until(async () => {
    const value = await second.service.observeForegroundProcess("s1");
    return value.foregroundBusy ? value : undefined;
  }, "the adopted session to report busy");
  assert.equal(observation.foregroundBusy, true);

  // And the same shell is still interactive.
  await second.service.write("s1", bytesOf("\x03"));
  await second.service.write("s1", bytesOf("echo back-$((2+3))\n"));
  await until(() => fresh.state.output.includes("back-5"), "input after adoption");
});

test("output beyond the bound while detached is dropped oldest-first and the command still completes", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const before = watch(first.service, "s1");
  await first.service.write("s1", bytesOf("echo ready-$((1+2))\n"));
  await until(() => before.state.output.includes("ready-3"), "the shell prompt");
  const acknowledged = first.service.getSession("s1").outputPosition;

  // 1.5 MiB against a 1 MiB ring, written only after the server has gone.
  await first.service.write("s1", bytesOf("sleep 1; head -c 1500000 /dev/zero | tr '\\0' x; echo; echo flood-$((3+4))-done\n"));
  await delay(100);
  await first.service.shutdown({ detach: true });
  await first.factory.detach();

  await delay(2_500);
  const second = await adoptAll(dataRoot);
  t.after(() => endEverything(second));
  const adopted = second.service.getSession("s1");
  const tail = watch(second.service, "s1", adopted.replayFrom);
  await until(() => tail.state.output.includes("flood-7-done"), "the flood to finish", 30_000);

  const settled = second.service.getSession("s1");
  assert.ok(settled.outputPosition > 1_500_000, "the position did not count dropped bytes");
  assert.ok(settled.replayFrom > acknowledged, "nothing was dropped");
  assert.ok(settled.outputPosition - settled.replayFrom <= 1024 * 1024 + 64 * 1024);

  // The position a client last acknowledged has fallen out of the ring.
  assert.throws(
    () => second.service.subscribe("s1", { fromPosition: acknowledged }),
    (error) => error instanceof TerminalServiceError && error.code === "replay_gap",
  );
});

test("a server from another build drains the old holder and still drives its sessions", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot, "build-a");
  await create(first.service, "old", dataRoot);
  const oldPid = first.service.getSession("old").pid;
  const [oldHolder] = readHolderRecords(dataRoot);
  await first.service.shutdown({ detach: true });
  await first.factory.detach();

  const second = await adoptAll(dataRoot, "build-b");
  t.after(() => endEverything(second));
  assert.equal(second.service.getSession("old").pid, oldPid);

  // A new terminal goes to a holder of the new build; the old one is untouched.
  await create(second.service, "new", dataRoot);
  const holders = readHolderRecords(dataRoot);
  assert.equal(holders.length, 2);
  assert.deepEqual(holders.map((record) => record.buildId).sort(), ["build-a", "build-b"]);
  assert.equal(isAlive(oldPid), true);

  const output = watch(second.service, "old", second.service.getSession("old").replayFrom);
  await second.service.write("old", bytesOf("echo old-$((5+5))\n"));
  await until(() => output.state.output.includes("old-10"), "the old session to answer");

  // The drained holder leaves once its last session is closed.
  await second.factory.end("old");
  await until(() => !isAlive(oldHolder.pid), "the drained holder to exit");
  assert.equal(isAlive(oldPid), false);
  assert.equal(second.service.getSession("new").status, "running");
});

test("end-all ends every shell and leaves no holder", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  await create(first.service, "s2", dataRoot);
  const pids = ["s1", "s2"].map((id) => first.service.getSession(id).pid);
  const [holder] = readHolderRecords(dataRoot);

  await endEverything(first);
  await until(() => !isAlive(holder.pid) && pids.every((pid) => !isAlive(pid)), "everything to end");
  assert.deepEqual(readHolderRecords(dataRoot), []);
  assert.deepEqual(["s1", "s2"].map((id) => first.service.getSession(id).status), ["interrupted", "interrupted"]);
});

test("a holder that dies takes its sessions with it and the server records an abnormal exit", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const seen = watch(first.service, "s1");
  const [holder] = readHolderRecords(dataRoot);

  process.kill(holder.pid, "SIGKILL");
  await until(() => seen.state.exits.length === 1, "the lost session to be reported");
  assert.notEqual(seen.state.exits[0].exitCode, 0, "a lost session looked like a clean exit");
  assert.equal(first.service.getSession("s1").status, "exited");
  await first.factory.detach();
});
