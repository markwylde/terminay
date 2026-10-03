import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

/**
 * An extension child whose server is killed outright must not outlive it.
 *
 * Nothing stops such a child on the server's behalf: a service unit that
 * signals only the server process (so that held terminals survive) does no
 * cleanup for it. The child ends itself when its channel closes, and that has
 * to hold even for an extension that left a worker thread blocked, which is
 * exactly what made `process.exit` hang there forever.
 */

const INDEX = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * Whether a process is still running. A process that has exited but has not
 * been reaped still answers a signal, and in a container whose first process
 * does not reap orphans it stays that way, so its state is read instead.
 */
function isAlive(pid) {
  try {
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return state.length > 0 && !state.startsWith("Z");
  } catch {
    return false;
  }
}

function childrenOf(pid) {
  try {
    return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

async function until(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(25);
  }
}

/**
 * An extension that parks a worker thread in a blocking system call. Unlike a
 * worker waiting in JavaScript, this one cannot be interrupted by the
 * termination request that process.exit sends before it joins the thread:
 * it is reading a FIFO nobody will ever write to.
 */
const blockingExtension = (fifo) => `
import { Worker } from "node:worker_threads";
export function activate() {
  new Worker(${JSON.stringify(`require("node:fs").readFileSync(${JSON.stringify(fifo)});`)}, { eval: true });
  return {};
}
`;

/** A stand-in server: start the extension host, then wait to be killed. */
const PARENT = `
import { ExtensionHost } from ${JSON.stringify(INDEX)};
const root = process.argv[2];
const host = new ExtensionHost("example.blocked-worker", { broker: { async request() {} } });
await host.start({
  extensionId: "example.blocked-worker",
  packageRoot: root,
  entrypoint: "extension.js",
  configDirectory: root + "/config",
  dataDirectory: root + "/data",
  cacheDirectory: root + "/cache",
  permissions: [],
});
process.stdout.write("ready\\n");
setInterval(() => {}, 60_000);
`;

test("an extension child with a blocked worker thread still exits when its server is killed", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "terminay-parent-loss-"));
  const fifo = join(root, "never-written");
  execFileSync("mkfifo", [fifo]);
  await writeFile(join(root, "extension.js"), blockingExtension(fifo), { mode: 0o600 });
  await writeFile(join(root, "parent.mjs"), PARENT, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));

  const parent = spawn(process.execPath, [join(root, "parent.mjs"), root], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  parent.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  let children = [];
  t.after(async () => {
    parent.kill("SIGKILL");
    for (const pid of children) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    await rm(root, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    parent.stdout.setEncoding("utf8").on("data", (chunk) => { if (chunk.includes("ready")) resolve(); });
    parent.once("close", () => reject(new Error(`the stand-in server exited early: ${stderr}`)));
  });
  children = await until(() => {
    const found = childrenOf(parent.pid);
    return found.length === 1 ? found : undefined;
  }, "the extension child");
  // Let the worker reach the call it will never return from.
  await delay(300);

  assert.equal(isAlive(children[0]), true);
  parent.kill("SIGKILL");
  await until(() => !isAlive(children[0]), "the extension child to exit after its server was killed");
});
