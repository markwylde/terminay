import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHost } from "../dist/index.js";

async function fixture(extensionId, source) {
  const root = await mkdtemp(join(tmpdir(), "terminay-extension-diagnostics-"));
  await writeFile(join(root, "extension.js"), source, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId,
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions: [],
  };
}

function collector() {
  const records = [];
  return {
    records,
    onDiagnostic: (record) => records.push(record),
    of: (transition) => records.filter((record) => record.transition === transition),
    first: (transition) => records.find((record) => record.transition === transition),
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

test("a child that throws asynchronously reports its error name, message, and stack", async () => {
  const descriptor = await fixture("example.throws", `
    export function activate() {
      setTimeout(() => { throw new TypeError("journal directory vanished"); }, 10);
      return { methods: {} };
    }
  `);
  const diagnostics = collector();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onDiagnostic: diagnostics.onDiagnostic,
  });
  await host.start(descriptor);
  await waitFor(() => diagnostics.first("failed") !== undefined, "no failure was recorded");

  const failed = diagnostics.first("failed");
  assert.equal(failed.error.name, "TypeError");
  assert.equal(failed.error.message, "journal directory vanished");
  assert.match(failed.error.stack, /journal directory vanished/u);
  assert.match(failed.error.stack, /extension\.js/u);
  assert.equal(failed.consecutiveFailures, 1);

  const exited = diagnostics.first("child-exited");
  assert.equal(exited.exitCode, 70, "an uncaught exception exits 70");
  assert.equal(exited.error.message, "journal directory vanished");
  assert.equal(exited.deliberate, false);
  await host.stop();
});

test("an unhandled rejection is reported with its own exit code", async () => {
  const descriptor = await fixture("example.rejects", `
    export function activate() {
      setTimeout(() => { Promise.reject(new Error("session file went missing")); }, 10);
      return { methods: {} };
    }
  `);
  const diagnostics = collector();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onDiagnostic: diagnostics.onDiagnostic,
  });
  await host.start(descriptor);
  await waitFor(() => diagnostics.first("failed") !== undefined, "no failure was recorded");

  assert.equal(diagnostics.first("failed").error.message, "session file went missing");
  assert.equal(diagnostics.first("child-exited").exitCode, 71, "an unhandled rejection exits 71");
  await host.stop();
});

test("a child killed without reporting still records the observed exit status", async () => {
  const descriptor = await fixture("example.killed", `
    export function activate() {
      setTimeout(() => { process.kill(process.pid, "SIGKILL"); }, 10);
      return { methods: {} };
    }
  `);
  const diagnostics = collector();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onDiagnostic: diagnostics.onDiagnostic,
  });
  await host.start(descriptor);
  await waitFor(() => diagnostics.first("child-exited") !== undefined, "no exit was recorded");

  const exited = diagnostics.first("child-exited");
  assert.equal(exited.error, undefined, "a killed child reports nothing");
  assert.equal(exited.signal, "SIGKILL");
  await host.stop();
});

test("every host transition is recorded once, with quarantine and its clearing", async () => {
  const descriptor = await fixture("example.lifecycle", `
    export function activate() {
      setTimeout(() => { throw new Error("crash on bind"); }, 5);
      return { methods: {} };
    }
  `);
  const diagnostics = collector();
  let now = 1_000;
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onDiagnostic: diagnostics.onDiagnostic,
    now: () => now,
    limits: { maxCrashesInWindow: 2, initialBackoffMs: 10 },
  });

  await host.start(descriptor);
  await waitFor(() => diagnostics.of("failed").length === 1, "first failure missing");
  assert.equal(diagnostics.first("spawned").consecutiveFailures, 0);
  assert.equal(diagnostics.first("ready").consecutiveFailures, 0);
  const scheduled = diagnostics.first("restart-scheduled");
  assert.equal(scheduled.restartAt, now + 10, "backoff is scheduled from the failure");

  now += 1_000;
  await host.start(descriptor);
  await waitFor(() => diagnostics.of("failed").length === 2, "second failure missing");
  const quarantined = diagnostics.first("quarantined");
  assert.equal(quarantined.consecutiveFailures, 2);
  assert.equal(quarantined.error.message, "crash on bind");
  assert.equal(host.status().state, "quarantined");
  assert.equal(diagnostics.of("restart-scheduled").length, 1, "a quarantined host schedules no restart");

  host.clearQuarantine();
  assert.equal(diagnostics.of("quarantine-cleared").length, 1);
  assert.equal(host.status().state, "stopped");
  assert.equal(host.status().consecutiveCrashes, 0);
});

test("a deliberate stop is recorded as deliberate", async () => {
  const descriptor = await fixture("example.stops", `
    export function activate() { return { methods: {} }; }
  `);
  const diagnostics = collector();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onDiagnostic: diagnostics.onDiagnostic,
  });
  await host.start(descriptor);
  await host.stop();

  const stopped = diagnostics.first("stopped");
  assert.equal(stopped.deliberate, true);
  assert.equal(diagnostics.first("failed"), undefined, "a deliberate stop is not a failure");
  assert.equal(diagnostics.first("child-exited").deliberate, true);
});

test("state changes are observable without polling", async () => {
  const descriptor = await fixture("example.observed", `
    export function activate() { return { methods: {} }; }
  `);
  const states = [];
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onStateChange: (status) => states.push(status.state),
    onDiagnostic: () => { throw new Error("a broken sink must not break the host"); },
  });
  await host.start(descriptor);
  await host.stop();
  assert.deepEqual(states, ["starting", "running", "stopped"]);
});

test("an absent diagnostic listener is a silent no-op", async () => {
  const descriptor = await fixture("example.silent", `
    export function activate() { return { methods: {} }; }
  `);
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} } });
  await host.start(descriptor);
  assert.equal(host.status().state, "running");
  await host.stop();
});
