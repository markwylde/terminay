import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkHolderHealth,
  checkOwnHealth,
  createSessionHolderPtyFactory,
  holderIsHealthy,
  holderTmpUnusable,
  launchDetachedSessionHolder,
  probeTemporaryDirectory,
  readHolderRecords,
  TerminalService,
} from "../dist/index.js";

/**
 * ADR-0115: a holder an earlier server launched takes new sessions only while
 * its environment is healthy, and its sessions are marked only when their
 * temporary directory is positively broken.
 */

const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const SERVER_ID = "srv";

const OK = { sameNamespace: "yes", tmp: "ok", tmpdir: "ok" };
const OWN_OK = { tmp: "ok", tmpdir: "ok" };

// ---------------------------------------------------------------------------
// The checks themselves, against an injected procfs.

function procfs({ ownNs = "mnt:[1]", theirNs = "mnt:[1]", environ = "PATH=/bin\0", paths = {}, unreadable = false } = {}) {
  const probed = [];
  return {
    probed,
    host: {
      readlink: async (path) => {
        if (unreadable && path !== "/proc/self/ns/mnt") throw Object.assign(new Error("denied"), { code: "EACCES" });
        return path === "/proc/self/ns/mnt" ? ownNs : theirNs;
      },
      readFile: async () => {
        if (unreadable) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return Buffer.from(environ);
      },
      probeDirectory: async (path) => {
        probed.push(path);
        if (unreadable && path.startsWith("/proc/")) return "unknown";
        return paths[path] ?? "ok";
      },
      env: { TMPDIR: undefined },
    },
  };
}

test("a holder in this server's namespace with working temporary directories is healthy", async () => {
  const { host, probed } = procfs();
  const facts = await checkHolderHealth(42, host);
  assert.deepEqual(facts, OK);
  assert.equal(holderIsHealthy(facts), true);
  // Seen through the holder's own root, not this server's.
  assert.deepEqual(probed, ["/proc/42/root/tmp"]);
});

test("another mount namespace alone makes a holder unhealthy, and marks nothing", async () => {
  const { host } = procfs({ theirNs: "mnt:[2]" });
  const facts = await checkHolderHealth(42, host);
  assert.deepEqual(facts, { sameNamespace: "no", tmp: "ok", tmpdir: "ok" });
  assert.equal(holderIsHealthy(facts), false);
  assert.equal(holderTmpUnusable(facts, OWN_OK), false);
});

test("a deleted /tmp is missing, and marks the holder's sessions", async () => {
  const { host } = procfs({ theirNs: "mnt:[2]", paths: { "/proc/42/root/tmp": "missing" } });
  const facts = await checkHolderHealth(42, host);
  assert.deepEqual(facts, { sameNamespace: "no", tmp: "missing", tmpdir: "missing" });
  assert.equal(holderTmpUnusable(facts, OWN_OK), true);
});

test("the holder's own TMPDIR is checked inside its root", async () => {
  const { host, probed } = procfs({
    environ: "HOME=/home/t\0TMPDIR=/var/scratch\0",
    paths: { "/proc/42/root/var/scratch": "missing" },
  });
  const facts = await checkHolderHealth(42, host);
  assert.deepEqual(facts, { sameNamespace: "yes", tmp: "ok", tmpdir: "missing" });
  assert.deepEqual(probed, ["/proc/42/root/tmp", "/proc/42/root/var/scratch"]);
  assert.equal(holderTmpUnusable(facts, OWN_OK), true);
});

test("a read-only /tmp is unwritable", async () => {
  const { host } = procfs({ paths: { "/proc/42/root/tmp": "unwritable" } });
  const facts = await checkHolderHealth(42, host);
  assert.equal(facts.tmp, "unwritable");
  assert.equal(holderIsHealthy(facts), false);
  assert.equal(holderTmpUnusable(facts, OWN_OK), true);
});

test("an unreadable /proc gives unknown: unhealthy, but never marked", async () => {
  const { host } = procfs({ unreadable: true });
  const facts = await checkHolderHealth(42, host);
  assert.deepEqual(facts, { sameNamespace: "unknown", tmp: "unknown", tmpdir: "unknown" });
  assert.equal(holderIsHealthy(facts), false);
  assert.equal(holderTmpUnusable(facts, OWN_OK), false);
});

test("when this server's own /tmp fails too, the problem is the host's and nothing is marked", async () => {
  const { host } = procfs({ paths: { "/tmp": "unwritable", "/proc/42/root/tmp": "unwritable" } });
  const own = await checkOwnHealth(host);
  assert.deepEqual(own, { tmp: "unwritable", tmpdir: "unwritable" });
  assert.equal(holderTmpUnusable(await checkHolderHealth(42, host), own), false);
});

test("a directory probe tells a working, a missing, and a read-only directory apart", { skip: process.getuid?.() === 0 && "root writes anywhere" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "th-probe-"));
  t.after(() => {
    chmodSync(join(root, "ro"), 0o700);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "ro"));
  chmodSync(join(root, "ro"), 0o500);
  assert.equal(await probeTemporaryDirectory(root), "ok");
  assert.equal(await probeTemporaryDirectory(join(root, "absent")), "missing");
  assert.equal(await probeTemporaryDirectory(join(root, "ro")), "unwritable");
});

test("on Linux, a sibling process under the same uid is checked through the real /proc", { skip: process.platform !== "linux" && "Linux only" }, async (t) => {
  const sibling = spawn("sleep", ["30"], { stdio: "ignore" });
  t.after(() => sibling.kill("SIGKILL"));
  const facts = await checkHolderHealth(sibling.pid);
  assert.deepEqual(facts, OK);
});

// ---------------------------------------------------------------------------
// The factory: which holder takes new sessions, and which sessions are marked.

const launched = new Set();

function dataRootFor(t) {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(() => {
    for (const record of readHolderRecords(dataRoot)) {
      try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return dataRoot;
}

function server(dataRoot, health) {
  const reports = [];
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId: "build-a",
    limitMs: 60_000,
    launch: ({ env }) => {
      const child = launchDetachedSessionHolder(process.execPath, [ENTRY], { ...process.env, ...env });
      launched.add(child.pid);
      return child;
    },
    onObservation: (report) => reports.push(report),
    ...(health === undefined ? {} : { health }),
  });
  const service = new TerminalService({ serverId: SERVER_ID, ptyFactory: factory });
  return { factory, service, reports, of: (kind) => reports.filter((report) => report.kind === kind) };
}

const create = (service, sessionId, dataRoot) =>
  service.createSession({ projectId: "p1", sessionId, shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });

async function leave({ service, factory }) {
  await service.shutdown({ detach: true });
  await factory.detach();
}

/** A first server leaves S1 in a holder; returns that holder's pid. */
async function leaveOneSession(dataRoot) {
  const first = server(dataRoot, false);
  await create(first.service, "s1", dataRoot);
  const [record] = readHolderRecords(dataRoot);
  await leave(first);
  return record.pid;
}

function scripted(facts, own = OWN_OK) {
  const asked = [];
  return {
    asked,
    health: {
      holder: async (pid) => { asked.push(pid); return facts; },
      own: async () => own,
    },
  };
}

async function adopt(next, sessionId) {
  const taken = await next.factory.adopt(sessionId);
  next.service.adoptSession({
    identity: { serverId: SERVER_ID, projectId: "p1", sessionId },
    cwd: taken.record.cwd,
    createdAt: taken.record.createdAt,
    cols: taken.record.cols,
    rows: taken.record.rows,
    process: taken.process,
    outputPosition: taken.from,
    ...(taken.degraded === undefined ? {} : { degraded: taken.degraded }),
  });
  return taken;
}

test("a same-build holder whose /tmp is gone takes no new session, and its session is marked", async (t) => {
  const dataRoot = dataRootFor(t);
  const oldPid = await leaveOneSession(dataRoot);
  const facts = { sameNamespace: "no", tmp: "missing", tmpdir: "missing" };
  const { health, asked } = scripted(facts);
  const next = server(dataRoot, health);
  t.after(async () => { await next.service.shutdown(); await next.factory.endAll(); });

  const held = await next.factory.start();
  assert.deepEqual(asked, [oldPid]);
  assert.equal(held[0].degraded, "tmp-unusable");
  assert.deepEqual(next.of("drained"), [{
    kind: "drained",
    holder: { pid: oldPid, startedAt: next.of("attached")[0].holder.startedAt },
    cause: "unhealthy",
    facts,
    degraded: true,
  }]);
  const taken = await adopt(next, "s1");
  assert.equal(taken.degraded, "tmp-unusable");
  assert.equal(next.service.getSession({ serverId: SERVER_ID, projectId: "p1", sessionId: "s1" }).degraded, "tmp-unusable");

  // A new terminal goes to a holder this server launches, which is trusted.
  await create(next.service, "s2", dataRoot);
  assert.equal(next.of("launched").length, 1);
  assert.notEqual(next.of("launched")[0].holder.pid, oldPid);
  assert.deepEqual(asked, [oldPid], "a holder this server launched is not checked");
  assert.equal(next.service.getSession({ serverId: SERVER_ID, projectId: "p1", sessionId: "s2" }).degraded, undefined);
});

test("a holder that cannot be checked is passed over, and nothing is marked", async (t) => {
  const dataRoot = dataRootFor(t);
  await leaveOneSession(dataRoot);
  const facts = { sameNamespace: "unknown", tmp: "unknown", tmpdir: "unknown" };
  const next = server(dataRoot, scripted(facts).health);
  t.after(async () => { await next.service.shutdown(); await next.factory.endAll(); });

  const held = await next.factory.start();
  assert.equal(held[0].degraded, undefined);
  assert.equal(next.of("drained")[0].cause, "health-unknown");
  assert.equal("degraded" in next.of("drained")[0], false);
  assert.equal((await adopt(next, "s1")).degraded, undefined);
  await create(next.service, "s2", dataRoot);
  assert.equal(next.of("launched").length, 1);
});

test("a namespace difference alone passes the holder over without marking its sessions", async (t) => {
  const dataRoot = dataRootFor(t);
  await leaveOneSession(dataRoot);
  const next = server(dataRoot, scripted({ sameNamespace: "no", tmp: "ok", tmpdir: "ok" }).health);
  t.after(async () => { await next.service.shutdown(); await next.factory.endAll(); });
  const held = await next.factory.start();
  assert.equal(held[0].degraded, undefined);
  assert.equal(next.of("drained")[0].cause, "unhealthy");
  await create(next.service, "s2", dataRoot);
  assert.equal(next.of("launched").length, 1);
});

test("a healthy holder is reused for new sessions", async (t) => {
  const dataRoot = dataRootFor(t);
  await leaveOneSession(dataRoot);
  const next = server(dataRoot, scripted(OK).health);
  t.after(async () => { await next.service.shutdown(); await next.factory.endAll(); });
  const held = await next.factory.start();
  assert.equal(held[0].degraded, undefined);
  assert.deepEqual(next.of("drained"), []);
  await create(next.service, "s2", dataRoot);
  assert.deepEqual(next.of("launched"), []);
  assert.equal(readHolderRecords(dataRoot).length, 1);
});

test("a host whose own /tmp fails is reported once, marks nothing, and still launches", async (t) => {
  const dataRoot = dataRootFor(t);
  await leaveOneSession(dataRoot);
  const own = { tmp: "unwritable", tmpdir: "unwritable" };
  const next = server(dataRoot, scripted({ sameNamespace: "yes", tmp: "unwritable", tmpdir: "unwritable" }, own).health);
  t.after(async () => { await next.service.shutdown(); await next.factory.endAll(); });
  const held = await next.factory.start();
  assert.equal(held[0].degraded, undefined);
  assert.deepEqual(next.of("host-tmp-unusable"), [{ kind: "host-tmp-unusable", facts: own }]);
  await create(next.service, "s2", dataRoot);
  assert.equal(next.of("launched").length, 1);
});

test("without a check, as on macOS and Windows, an attached holder is reused as before", async (t) => {
  const dataRoot = dataRootFor(t);
  await leaveOneSession(dataRoot);
  const next = server(dataRoot, false);
  t.after(async () => { await next.service.shutdown(); await next.factory.endAll(); });
  const held = await next.factory.start();
  assert.equal(held[0].degraded, undefined);
  await create(next.service, "s2", dataRoot);
  assert.deepEqual(next.of("launched"), []);
});

test("a marked session ends exactly as any other: by its shell exiting, or by being ended", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot, false);
  await create(first.service, "s1", dataRoot);
  await create(first.service, "s3", dataRoot);
  await leave(first);
  const next = server(dataRoot, scripted({ sameNamespace: "no", tmp: "missing", tmpdir: "missing" }).health);
  t.after(async () => { await next.factory.endAll(); });
  const held = await next.factory.start();
  assert.ok(held.every((session) => session.degraded === "tmp-unusable"));

  // Its shell exits: reported as any exit is, and not asked for.
  await adopt(next, "s1");
  const s1 = { serverId: SERVER_ID, projectId: "p1", sessionId: "s1" };
  const exited = new Promise((resolve) => {
    next.service.subscribe(s1, { onEvent: (event) => { if (event.type === "exit") resolve(event); } });
  });
  await next.service.write(s1, "exit 3\r");
  assert.equal((await exited).exitCode, 3);

  // Ended on request, as closing its panel does.
  await adopt(next, "s3");
  const s3 = { serverId: SERVER_ID, projectId: "p1", sessionId: "s3" };
  const ended = new Promise((resolve) => {
    next.service.subscribe(s3, { onEvent: (event) => { if (event.type === "exit") resolve(event); } });
  });
  await next.factory.end("s3");
  await ended;
  await next.service.shutdown();
});

test("a marked session left unattached is ended by the holder's limit, as any other", async (t) => {
  const dataRoot = dataRootFor(t);
  await leaveOneSession(dataRoot);
  const next = server(dataRoot, scripted({ sameNamespace: "no", tmp: "missing", tmpdir: "missing" }).health);
  const [held] = await next.factory.start();
  assert.equal(held.degraded, "tmp-unusable");
  const [record] = readHolderRecords(dataRoot);
  next.factory.setLimit(200);
  await leave(next);
  // The drained holder ends its unattached session at the limit, then exits.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { process.kill(record.pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("the holder kept a marked session past its unattached limit");
});

test("the health check reads and reports, and never ends or signals anything", () => {
  const source = readFileSync(new URL("../src/sessionHolder/health.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.end\(|endAll|\.kill\(|process\.kill|\.signal\(|\.drain\(/u);
});
