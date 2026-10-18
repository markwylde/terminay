import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHost } from "../dist/index.js";

const PROVIDER = "example.channel-loss/cli";

/**
 * A child that speaks the protocol directly, so the exact shape that
 * quarantined Claude Code can be reproduced: several session publications
 * still awaiting the host when the child process dies.
 */
const FAKE_CHILD = `
process.on('message', (frame) => {
  if (frame.kind === 'activate') {
    process.send({ protocolVersion: 1, kind: 'ready', id: frame.id, payload: {
      methods: [], agentSessionSources: ['${PROVIDER}'],
    } });
    return;
  }
  if (frame.kind === 'agent.source.start') {
    process.send({ protocolVersion: 1, kind: 'result', id: frame.id });
    // Publish more than the crash threshold, then die with them all in flight:
    // once the channel has written the last of them, not before.
    let written = 0;
    for (let index = 0; index < 10; index += 1) {
      process.send({ protocolVersion: 1, kind: 'agent.source.publish', id: 'publication-' + index, payload: {
        sourceId: '${PROVIDER}',
        upserts: [{ id: 'session-' + index, harness: 'fixture', pid: 100 + index, cwd: '/work', title: 'Publication ' + index }],
      } }, () => { written += 1; if (written === 10) process.exit(9); });
    }
    return;
  }
});
`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-channel-loss-"));
  await writeFile(join(root, "extension.js"), "export function activate() { return {}; }", { mode: 0o600 });
  await writeFile(join(root, "child.mjs"), FAKE_CHILD, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    childEntrypoint: join(root, "child.mjs"),
    descriptor: {
      extensionId: "example.channel-loss",
      packageRoot: root,
      entrypoint: "extension.js",
      configDirectory: join(root, "config"),
      dataDirectory: join(root, "data"),
      cacheDirectory: join(root, "cache"),
      permissions: ["agent-observation"],
      agentSessionSources: [{
        id: PROVIDER,
        displayName: "Channel loss",
        harnesses: [{ id: "fixture", displayName: "Fixture" }],
      }],
    },
  };
}

/** Diagnostics as the host reports them; `until` re-checks as each arrives. */
function diagnostics() {
  const records = [];
  const waiters = new Set();
  return {
    records,
    onDiagnostic(record) {
      records.push(record);
      for (const waiter of [...waiters]) waiter();
    },
    until(check) {
      if (check()) return Promise.resolve();
      return new Promise((resolve) => {
        const waiter = () => {
          if (!check()) return;
          waiters.delete(waiter);
          resolve();
        };
        waiters.add(waiter);
      });
    },
  };
}

test("a child dying with publications in flight counts one death, not one per acknowledgement", async () => {
  const value = await fixture();
  const { records, onDiagnostic, until } = diagnostics();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let owed = 0;
  const host = new ExtensionHost(value.descriptor.extensionId, {
    broker: { async request() {} },
    childEntrypoint: value.childEntrypoint,
    onDiagnostic,
    limits: { maxCrashesInWindow: 5 },
    // Hold every publication open, so all ten acknowledgements are still owed
    // when the child dies — the recorded incident's exact shape.
    agents: {
      async publish() { owed += 1; await held; return { ok: true }; },
    },
  });

  await host.start(value.descriptor);
  await host.startSessionSource(PROVIDER, ["fixture"]);

  await until(() => records.some((record) => record.transition === "child-exited"));
  release();
  // Each owed acknowledgement finds the channel closed and says so: once all
  // of them have, every discovery of the death has been made.
  await until(() => records.filter((record) => record.transition === "channel-closed").length >= owed);

  const counted = records.filter(
    (record) => record.transition === "failed" && record.afterChildGone !== true,
  );
  assert.equal(counted.length, 1, "one death is one crash, however many acknowledgements discover it");
  assert.equal(host.status().consecutiveCrashes, 1);
  assert.notEqual(host.status().state, "quarantined", "ten pending acknowledgements must not quarantine an extension");

  const exited = records.find((record) => record.transition === "child-exited");
  assert.equal(exited.exitCode, 9, "the real exit code survives, rather than a synthetic SIGKILL");

  const closed = records.filter((record) => record.transition === "channel-closed");
  assert.ok(closed.length > 0, "writing to the dead child is recorded as a closed channel");
  assert.equal(
    records.some((record) => /exceeds IPC limit/u.test(record.error?.message ?? "")),
    false,
    "and never reported as a size limit it did not hit",
  );
  await host.stop();
});

test("a write refused after the child has gone and repeated child errors never become uncaught", async () => {
  const value = await fixture();
  const { records, onDiagnostic, until } = diagnostics();
  const host = new ExtensionHost(value.descriptor.extensionId, {
    broker: { async request() {} },
    childEntrypoint: value.childEntrypoint,
    onDiagnostic,
    agents: { async publish() { return { ok: true }; } },
  });
  await host.start(value.descriptor);
  const child = host["child"];
  // The incident: the channel still reads as connected, the peer has died, and
  // the operating system refuses each queued write with EPIPE. Node reports
  // that on the callback when there is one, or as an `error` event otherwise.
  let refusedWrites = 0;
  let allRefused;
  const refusedAll = new Promise((resolve) => { allRefused = resolve; });
  child.send = (_frame, callback) => {
    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE", errno: -32, syscall: "write" });
    const refuse = typeof callback === "function" ? () => callback(error) : () => child.emit("error", error);
    process.nextTick(() => {
      refuse();
      refusedWrites += 1;
      if (refusedWrites === 5) allRefused();
    });
    return true;
  };
  for (let index = 0; index < 5; index += 1)
    host["send"]({ protocolVersion: 1, kind: "agent.source.ack", id: `ack-${index}`, payload: {} });
  await refusedAll;

  // A ChildProcess emits `error` once per failed write or kill. An emitter
  // with no listener throws, which in Terminay's main process is an abort.
  const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  assert.doesNotThrow(() => child.emit("error", error));
  assert.doesNotThrow(() => child.emit("error", error));

  const refused = records.filter((record) => record.transition === "channel-write-failed");
  assert.equal(refused.length, 1, "the first refused write is recorded, the rest are counted");
  assert.equal(refused[0].errorCode, "EPIPE");
  const errors = records.filter((record) => record.transition === "child-error");
  assert.equal(errors.length, 2, "every child error is recorded");
  assert.equal(errors[0].errorCode, "EPIPE");
  assert.equal(
    records.filter((record) => record.transition === "failed" && record.afterChildGone !== true).length,
    1,
    "repeated errors from one child count as one failure",
  );

  process.kill(child.pid, "SIGKILL");
  await until(() => records.some((record) => record.transition === "child-exited"));
  const exited = records.find((record) => record.transition === "child-exited");
  assert.equal(exited.failedWrites, 5, "the exit record carries how many writes the child never received");
  assert.equal(typeof exited.pendingCalls, "number");
  await host.stop();
});

test("an extension child keeps running when its channel's write queue is long", async () => {
  const value = await fixture();
  // Run the real child, but make `process.send` report a long write queue the
  // way Node does under a burst: the frame is queued and delivered, and the
  // call returns false. The child used to treat that as a lost frame and exit.
  const wrapper = join(value.descriptor.packageRoot, "backlogged-child.mjs");
  await writeFile(
    wrapper,
    `const send = process.send.bind(process);
process.send = (...args) => { send(...args); return false; };
await import(${JSON.stringify(new URL("../dist/extensions/child.js", import.meta.url).href)});
`,
    { mode: 0o600 },
  );
  await writeFile(
    join(value.descriptor.packageRoot, "extension.js"),
    "export function activate() { return { methods: { echo(input) { return input; } } }; }",
    { mode: 0o600 },
  );
  const records = [];
  const host = new ExtensionHost("example.backlog", {
    broker: { async request() {} },
    childEntrypoint: wrapper,
    onDiagnostic: (record) => records.push(record),
  });
  const { agentSessionSources: _unused, ...descriptor } = value.descriptor;
  await host.start({ ...descriptor, extensionId: "example.backlog", permissions: [] });
  for (let index = 0; index < 5; index += 1)
    assert.equal(await host.invoke({ method: "echo", input: index }), index);
  assert.equal(host.status().state, "running");
  assert.equal(records.some((record) => record.transition === "child-exited"), false, "the child never exited");
  await host.stop();
});
