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
  // The host killed this child, so that is what is recorded: it never observed
  // an exit status and does not invent one.
  assert.equal(diagnostics.first("child-terminated").deliberate, true);
  assert.equal(diagnostics.first("child-exited"), undefined);
});

test("one death counts once however many paths discover it", async () => {
  // A child that dies during activation is discovered by its exit event and
  // again by the activation that was waiting on it. Both are the same death.
  const descriptor = await fixture("example.diesatonce", `
    process.exit(3);
    export function activate() { return { methods: {} }; }
  `);
  const diagnostics = collector();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onDiagnostic: diagnostics.onDiagnostic,
    limits: { maxCrashesInWindow: 2, startupTimeoutMs: 2_000 },
  });

  await assert.rejects(host.start(descriptor));
  assert.equal(host.status().consecutiveCrashes, 1, "one death, one crash");
  assert.notEqual(host.status().state, "quarantined", "and it does not reach the threshold on its own");
  assert.equal(
    diagnostics.of("failed").filter((record) => record.afterChildGone !== true).length,
    1,
    "exactly one failure is counted; any later discovery is recorded but not counted",
  );
});

test("repeated deaths still reach quarantine", async () => {
  const descriptor = await fixture("example.repeats", `
    export function activate() {
      setTimeout(() => { throw new Error("crash on bind"); }, 5);
      return { methods: {} };
    }
  `);
  const diagnostics = collector();
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    onDiagnostic: diagnostics.onDiagnostic,
    limits: { maxCrashesInWindow: 2, initialBackoffMs: 1 },
  });

  await host.start(descriptor);
  await waitFor(() => diagnostics.of("failed").length >= 1, "first death missing");
  await host.start(descriptor);
  await waitFor(() => host.status().state === "quarantined", "second death did not quarantine");
  assert.equal(host.status().consecutiveCrashes, 2, "each death counts once, and two is the threshold");
});

test("the exit status the system reported survives host teardown", async () => {
  // The host's own kill must not overwrite an exit it already observed: that
  // status is the only evidence of how the child actually ended.
  const descriptor = await fixture("example.exitcode", `
    export function activate() {
      setTimeout(() => { process.exit(42); }, 10);
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

  assert.equal(diagnostics.first("child-exited").exitCode, 42, "the real exit code is kept");
  await host.stop();
  assert.equal(diagnostics.of("child-exited").length, 1, "one exit record per child");
  assert.equal(
    diagnostics.of("child-terminated").length,
    0,
    "a child already known to have exited is not re-recorded as a host kill",
  );
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
