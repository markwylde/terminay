import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * An extension that parks a worker thread in a blocking system call. Unlike a
 * worker waiting in JavaScript, this one cannot be interrupted by the
 * termination request that process.exit sends before it joins the thread:
 * it is reading a FIFO nobody will ever write to.
 *
 * It also holds the write end of a second FIFO for as long as its process
 * lives, so the reader there sees end of file exactly when the process is gone.
 */
const blockingExtension = (fifo, lifeline) => `
import { openSync } from "node:fs";
import { Worker } from "node:worker_threads";
export function activate() {
  openSync(${JSON.stringify(lifeline)}, "w");
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
process.stdout.write("ready " + host["child"].pid + "\\n");
setInterval(() => {}, 60_000);
`;

test("an extension child with a blocked worker thread still exits when its server is killed", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "terminay-parent-loss-"));
  const fifo = join(root, "never-written");
  const lifeline = join(root, "lifeline");
  execFileSync("mkfifo", [fifo, lifeline]);
  await writeFile(join(root, "extension.js"), blockingExtension(fifo, lifeline), { mode: 0o600 });
  await writeFile(join(root, "parent.mjs"), PARENT, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));

  const parent = spawn(process.execPath, [join(root, "parent.mjs"), root], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  parent.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  let child;
  let writer;
  // Opened before the extension runs: its open of the write end waits for this.
  const lifelineEnded = new Promise((resolve, reject) => {
    createReadStream(lifeline).on("error", reject).on("end", resolve).resume();
  });
  t.after(async () => {
    parent.kill("SIGKILL");
    if (child !== undefined) {
      try { process.kill(child, "SIGKILL"); } catch { /* already gone */ }
    }
    await writer?.close();
    await rm(root, { recursive: true, force: true });
  });

  child = await new Promise((resolve, reject) => {
    let output = "";
    parent.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      const ready = /ready (\d+)\n/u.exec(output);
      if (ready !== null) resolve(Number(ready[1]));
    });
    parent.once("close", () => reject(new Error(`the stand-in server exited early: ${stderr}`)));
  });
  // Opening the never-written FIFO for writing completes only once the worker
  // has opened it for reading; with nothing ever written, its read then
  // blocks for good. The write end stays open so it never sees end of file.
  writer = await open(fifo, "w");

  assert.equal(isAlive(child), true);
  parent.kill("SIGKILL");
  // End of file on the lifeline: the extension child's process has ended.
  await lifelineEnded;
});
