import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionHolderPtyFactory,
  describeNativeModuleLoadFailure,
  launchDetachedSessionHolder,
  launchSessionHolder,
  readHolderRecords,
  SESSION_HOLDER_ENV,
  SESSION_HOLDER_FAILURE_REASON_BYTES,
  sessionHolderRecordPath,
  TerminalService,
  TerminalServiceError,
} from "../dist/index.js";

/**
 * A holder launch settles on events, never on a clock: the holder's record
 * appearing, its process exiting or failing to start, the watch failing, or
 * the server leaving. These tests drive each event themselves, so nothing in
 * them depends on how fast the machine is.
 */

const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const FAILING_ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry-failing.mjs", import.meta.url));
const GLIBC_REASON = "node-pty could not be loaded: Failed to load native module: pty.node; /opt/Terminay/pty.node: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.42' not found";
const SERVER_ID = "srv";

/** Every real holder this file launched, by pid. */
const holders = new Map();

function dataRootFor(t) {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(async () => {
    for (const record of readHolderRecords(dataRoot)) {
      try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
      const holder = holders.get(record.pid);
      if (holder !== undefined) {
        holder.child.ref();
        await holder.exited;
      }
    }
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return dataRoot;
}

/** A launched process the test speaks for: it exits or fails when told to. */
function fakeHolderProcess() {
  const child = new EventEmitter();
  child.killed = 0;
  child.kill = () => { child.killed += 1; };
  return child;
}

/** A launcher that hands the test the request and a process it controls. */
function controlledLauncher() {
  const child = fakeHolderProcess();
  let called;
  const launched = new Promise((resolve) => { called = resolve; });
  const launch = (request) => { called(request); return child; };
  return { launch, launched, child };
}

/** Whether a promise has settled, once every event already queued has run. */
async function settledYet(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
}

function server(dataRoot, launch) {
  const reports = [];
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId: "build-a",
    limitMs: 60_000,
    launch,
    onObservation: (report) => reports.push(report),
  });
  const service = new TerminalService({ serverId: SERVER_ID, ptyFactory: factory });
  return { factory, service, of: (kind) => reports.filter((report) => report.kind === kind) };
}

const resolvedLaunch = (service, sessionId, dataRoot) => ({
  identity: service.allocateIdentity("p1", sessionId),
  workspaceRevision: 1,
  settingsRevision: 1,
  profile: { id: "system", revision: 1, name: "System", targetSummary: "/bin/sh" },
  shellPath: "/bin/sh",
  args: [],
  cwd: dataRoot,
  env: {},
  createdAt: 1,
  cols: 80,
  rows: 24,
});

test("a holder that exits before it is ready fails the terminal at once, and no session is left", async (t) => {
  const dataRoot = dataRootFor(t);
  const { launch, launched, child } = controlledLauncher();
  const { service, of } = server(dataRoot, launch);

  const creating = service.createResolvedSession(resolvedLaunch(service, "s1", dataRoot));
  await launched;
  assert.equal(await settledYet(creating), false, "the launch settled before the holder did anything");
  child.emit("exit", 3, null);

  await assert.rejects(creating, (error) =>
    error instanceof TerminalServiceError &&
    error.code === "spawn_failed" &&
    error.details.reason.includes("session holder exited before it was ready (exit code 3)"));
  assert.equal(service.size, 0, "a terminal without a holder was kept");
  const [failed] = of("launch-failed");
  assert.equal(failed.error, "session holder exited before it was ready (exit code 3)");
  assert.ok(Number.isSafeInteger(failed.durationMs) && failed.durationMs >= 0);
});

test("a holder process that cannot be started fails the launch with its error", async (t) => {
  const dataRoot = dataRootFor(t);
  const { launch, launched, child } = controlledLauncher();
  const { factory } = server(dataRoot, launch);

  const spawning = factory.spawn({ projectId: "p1", sessionId: "s1", shellPath: "/bin/sh", shell: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });
  await launched;
  child.emit("error", Object.assign(new Error("spawn /no/such/runtime ENOENT"), { code: "ENOENT" }));
  await assert.rejects(spawning, { message: "session holder could not be started: spawn /no/such/runtime ENOENT" });
});

test("a holder that writes its record late is waited for, however long it takes", async (t) => {
  const dataRoot = dataRootFor(t);
  const { launch, launched, child } = controlledLauncher();
  const { factory, service } = server(dataRoot, launch);
  t.after(async () => { await service.shutdown(); await factory.endAll(); });

  const creating = service.createResolvedSession(resolvedLaunch(service, "s1", dataRoot));
  const { env } = await launched;
  // Nothing has started yet, so nothing can be ready: the launch is pending
  // for as long as the test chooses to wait before starting the holder.
  assert.equal(await settledYet(creating), false, "the launch gave up on a holder that had not started");

  const real = launchDetachedSessionHolder(process.execPath, [ENTRY], { ...process.env, ...env });
  holders.set(real.pid, { child: real, exited: new Promise((resolve) => real.once("exit", resolve)) });
  real.once("exit", (code, signal) => child.emit("exit", code, signal));

  const handle = await creating;
  const session = service.getSession(handle.identity.sessionId);
  assert.equal(session.status, "running");
  assert.ok(Number.isSafeInteger(session.pid) && session.pid > 0, "the terminal has no shell");
  assert.deepEqual(readHolderRecords(dataRoot).map((record) => record.pid), [real.pid]);
});

test("a record written before the watch began is found without a watch event", async (t) => {
  const dataRoot = dataRootFor(t);
  const generation = "0123456789abcdef";
  const child = fakeHolderProcess();
  // A pid no process has any more, so the clean-up that ends holders ends none.
  const pid = spawnSync("true").pid;
  // The launcher writes the record before it returns, so it is in place before
  // the launch starts watching for it.
  const launch = ({ env }) => {
    assert.equal(env[SESSION_HOLDER_ENV.generation], generation);
    const target = sessionHolderRecordPath(dataRoot, generation);
    writeFileSync(`${target}.tmp`, JSON.stringify({
      generation, pid, buildId: "build-a", versions: [1], credential: "c", socketPath: "", startedAt: 7,
    }));
    renameSync(`${target}.tmp`, target);
    return child;
  };
  const record = await launchSessionHolder({ dataRoot, buildId: "build-a", launch }, generation, null);
  assert.equal(record.generation, generation);
  assert.equal(record.startedAt, 7);
  // Settled on the record: a later exit of the process is no longer this launch's.
  assert.equal(child.listenerCount("exit"), 0);
});

test("a launch is abandoned when its caller aborts, and the holder it started is ended", async (t) => {
  const dataRoot = dataRootFor(t);
  const { launch, launched, child } = controlledLauncher();
  const abort = new AbortController();
  const launching = launchSessionHolder({ dataRoot, buildId: "build-a", launch }, "fedcba9876543210", null, abort.signal);
  await launched;
  abort.abort(new Error("caller left"));
  await assert.rejects(launching, { message: "caller left" });
  assert.equal(child.killed, 1);
});

test("a server that leaves while its holder is starting ends that launch", async (t) => {
  const dataRoot = dataRootFor(t);
  const { launch, launched, child } = controlledLauncher();
  const { factory } = server(dataRoot, launch);
  const spawning = factory.spawn({ projectId: "p1", sessionId: "s1", shellPath: "/bin/sh", shell: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });
  await launched;
  await factory.detach();
  await assert.rejects(spawning, { message: "the server is leaving" });
  assert.equal(child.killed, 1);
});

test("a holder says it is ready by closing the descriptor its launcher holds, once its record is in place", async (t) => {
  const dataRoot = dataRootFor(t);
  const generation = "a1b2c3d4e5f60718";
  const real = launchDetachedSessionHolder(process.execPath, [ENTRY], {
    ...process.env,
    [SESSION_HOLDER_ENV.dataRoot]: dataRoot,
    [SESSION_HOLDER_ENV.generation]: generation,
    [SESSION_HOLDER_ENV.buildId]: "build-a",
    [SESSION_HOLDER_ENV.limitMs]: "none",
  });
  holders.set(real.pid, { child: real, exited: new Promise((resolve) => real.once("exit", resolve)) });
  const ready = real.stdio[3];
  ready.resume();
  await new Promise((resolve) => ready.once("close", resolve));
  // Heard on the descriptor, with no watch: the record is already there.
  assert.deepEqual(readHolderRecords(dataRoot).map((record) => [record.generation, record.pid]), [[generation, real.pid]]);
  assert.equal(real.exitCode, null, "the holder ended instead of becoming ready");
});

/** A fake holder with a readiness descriptor the test writes and closes. */
function holderWithReadiness() {
  const child = fakeHolderProcess();
  child.stdio = [null, null, null, new PassThrough()];
  return child;
}

test("a holder that cannot start says why, and the launch failure carries the reason", async (t) => {
  const dataRoot = dataRootFor(t);
  const child = holderWithReadiness();
  const { service, of } = server(dataRoot, () => child);

  const creating = service.createResolvedSession(resolvedLaunch(service, "s1", dataRoot));
  await new Promise((resolve) => setImmediate(resolve));
  child.stdio[3].end(GLIBC_REASON);
  await new Promise((resolve) => child.stdio[3].once("close", resolve));
  child.emit("exit", 1, null);

  const expected = `session holder exited before it was ready (exit code 1): ${GLIBC_REASON}`;
  await assert.rejects(creating, (error) =>
    error instanceof TerminalServiceError && error.details.reason.includes(expected));
  assert.equal(of("launch-failed")[0].error, expected);
});

test("a holder whose exit is heard before its reason is waited for until the descriptor closes", async (t) => {
  const dataRoot = dataRootFor(t);
  const child = holderWithReadiness();
  const launching = launchSessionHolder({ dataRoot, buildId: "build-a", launch: () => child }, "0a0b0c0d0e0f1011", null);

  child.emit("exit", null, "SIGABRT");
  assert.equal(await settledYet(launching), false, "the launch failed before the holder's reason could arrive");
  child.stdio[3].write("holder environment is incomplete\n");
  child.stdio[3].end();
  await assert.rejects(launching, {
    message: "session holder exited before it was ready (signal SIGABRT): holder environment is incomplete",
  });
});

test("a real holder that cannot start reports a bounded reason to its launcher", async (t) => {
  const dataRoot = dataRootFor(t);
  // Longer than the bound, and made of two-byte characters so a cut could split one.
  const reason = `${GLIBC_REASON} ${"é".repeat(SESSION_HOLDER_FAILURE_REASON_BYTES)}`;
  const launch = ({ env }) => launchDetachedSessionHolder(process.execPath, [FAILING_ENTRY], {
    ...process.env,
    ...env,
    TERMINAY_TEST_HOLDER_FAILURE: reason,
  });
  const failure = await launchSessionHolder({ dataRoot, buildId: "build-a", launch }, "1a2b3c4d5e6f7081", null).then(
    () => assert.fail("a holder that could not start was reported ready"),
    (error) => error,
  );
  const prefix = "session holder exited before it was ready (exit code 1): ";
  assert.ok(failure.message.startsWith(prefix + GLIBC_REASON), failure.message);
  const told = failure.message.slice(prefix.length);
  assert.ok(Buffer.byteLength(told) <= SESSION_HOLDER_FAILURE_REASON_BYTES);
  assert.ok(!told.includes("\uFFFD"), "the reason was cut inside a character");
});

test("a native module failure names the loader error of the addon that is present", () => {
  const searched = new Error(
    "Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-x64: Error: Cannot find module './prebuilds/linux-x64//pty.node'\nRequire stack:\n- /opt/x/utils.js",
  );
  const load = (path) => {
    throw new Error(`/lib/x86_64-linux-gnu/libc.so.6: version \`GLIBC_2.42' not found (required by ${path})`);
  };
  assert.equal(
    describeNativeModuleLoadFailure(searched, load, ["/opt/x/build/Release/pty.node"]),
    "Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-x64: Error: Cannot find module './prebuilds/linux-x64//pty.node'; " +
      "/opt/x/build/Release/pty.node: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.42' not found (required by /opt/x/build/Release/pty.node)",
  );
  // An addon that loads, or fails the same way as the search, adds nothing.
  assert.equal(describeNativeModuleLoadFailure(new Error("broken"), () => undefined, ["/a.node"]), "broken");
  assert.equal(
    describeNativeModuleLoadFailure(new Error("x: broken"), () => { throw new Error("broken"); }, ["/a.node"]),
    "x: broken",
  );
});

test("a Windows holder is launched into a directory closed to other users, and told whose it is", async (t) => {
  const dataRoot = dataRootFor(t);
  const { launch, launched, child } = controlledLauncher();
  const protectedDirectories = [];
  const addressing = { platform: "win32", userSid: "S-1-5-21-1-2-3-1001" };
  const launching = launchSessionHolder({
    dataRoot,
    buildId: "build-a",
    launch,
    addressing,
    protectDirectory: (path, sid) => { protectedDirectories.push([path, sid]); return true; },
  }, "0123456789abcdef", null);
  const request = await launched;
  assert.deepEqual(protectedDirectories, [[join(dataRoot, "session-holder"), addressing.userSid]]);
  assert.equal(request.env[SESSION_HOLDER_ENV.userSid], addressing.userSid);
  child.emit("exit", 1, null);
  await assert.rejects(launching);
});

test("a Windows holder is not launched where its directory cannot be closed", async (t) => {
  const dataRoot = dataRootFor(t);
  let launched = false;
  await assert.rejects(
    launchSessionHolder({
      dataRoot,
      buildId: "build-a",
      launch: () => { launched = true; return fakeHolderProcess(); },
      addressing: { platform: "win32", userSid: "S-1-5-21-1-2-3-1001" },
      protectDirectory: () => false,
    }, "0123456789abcdef", null),
    { message: "session holder directory could not be protected" },
  );
  assert.equal(launched, false);
});
