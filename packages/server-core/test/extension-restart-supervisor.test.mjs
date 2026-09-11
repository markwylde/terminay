import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createDefaultExtensionManagement } from "../dist/extensions/index.js";

const PACKAGE = "terminay-crashing-fixture";
const EXTENSION = "com.terminay.crashing-fixture";
const INTEGRITY = `sha512-${Buffer.alloc(64, 5).toString("base64")}`;

function manifest() {
  return {
    manifestVersion: 1,
    id: EXTENSION,
    displayName: "Crashing fixture",
    api: "^2.0.0",
    engines: { terminay: ">=1", node: ">=22" },
    entrypoint: "dist/extension.js",
    permissions: ["agent-observation"],
    contributes: {
      agentProviders: [{ id: `${EXTENSION}/cli`, displayName: "Fixture" }],
    },
  };
}

/**
 * An extension that throws asynchronously on its first `crashes` activations
 * and succeeds afterwards. A counter file outside the package survives every
 * restart, so the fixture recovers like a real one that hit a transient fault.
 *
 * Activation zero is the installer's own package probe, which starts and stops
 * the host before the extension is ever enabled; it is deliberately not one of
 * the crashes under test.
 */
function tree(version, counterPath, crashes) {
  const packageJson = JSON.stringify({
    name: PACKAGE,
    version,
    type: "module",
    exports: { ".": "./dist/extension.js" },
    terminay: manifest(),
  });
  const source = `
    import { readFileSync, writeFileSync } from "node:fs";
    export function activate(context) {
      context.agents.registerProvider("${EXTENSION}/cli", { mappingVersion: "v1", matchesForeground() { return true; }, async observe() { return { state: "not-bound" }; } });
      let attempts = 0;
      try { attempts = Number(readFileSync(${JSON.stringify(counterPath)}, "utf8")) || 0; } catch {}
      writeFileSync(${JSON.stringify(counterPath)}, String(attempts + 1));
      if (attempts > 0 && attempts <= ${crashes})
        setTimeout(() => { throw new Error("crash on bind " + attempts); }, 5);
      return { methods: {} };
    }
  `;
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: { "": {}, [`node_modules/${PACKAGE}`]: { version, resolved: `file:${PACKAGE}-${version}.tgz`, integrity: INTEGRITY } },
  });
  const files = [
    ["package-lock.json", lock],
    [`node_modules/${PACKAGE}/package.json`, packageJson],
    [`node_modules/${PACKAGE}/dist/extension.js`, source],
  ];
  const inventory = files
    .map(([path, body]) => ({ path, size: Buffer.byteLength(body), hash: createHash("sha256").update(body).digest("hex") }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    inventoryHash: createHash("sha256").update(JSON.stringify(inventory)).digest("hex"),
    lockHash: createHash("sha256").update(lock).digest("hex"),
  };
}

class BuiltIns {
  constructor(counterPath, crashes) {
    this.value = tree("1.0.0", counterPath, crashes);
  }
  async list() {
    return [{
      extensionId: EXTENSION,
      packageName: PACKAGE,
      version: "1.0.0",
      integrity: INTEGRITY,
      source: "built-in",
      manifestMetadata: manifest(),
      inventoryHash: this.value.inventoryHash,
      lockHash: this.value.lockHash,
      provenance: "verified",
    }];
  }
  async materialize(_artifact, root) {
    for (const [path, body] of this.value.files) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    }
  }
}

/** A schedule whose timers only fire when the test says so. */
function clock() {
  const queued = [];
  return {
    queued,
    schedule: (callback, milliseconds) => {
      const timer = { callback, milliseconds, cancelled: false };
      queued.push(timer);
      return timer;
    },
    cancel: (timer) => {
      // Mirror clearTimeout: a cancelled timer leaves the schedule entirely.
      // Leaving it queued let a later runNext() shift a dead timer and trip on
      // it, which is how this test failed in CI and passed everywhere else.
      timer.cancelled = true;
      const at = queued.indexOf(timer);
      if (at !== -1) queued.splice(at, 1);
    },
    async runNext() {
      const timer = queued.shift();
      assert.ok(timer !== undefined, "no restart was scheduled");
      assert.equal(timer.cancelled, false, "the scheduled restart was cancelled");
      await timer.callback();
    },
    pending: () => queued.filter((timer) => !timer.cancelled).length,
  };
}

async function fixture(crashes) {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-restart-supervisor-"));
  const counterPath = join(dataRoot, "activations");
  const records = [];
  const timers = clock();
  const management = createDefaultExtensionManagement({
    dataRoot,
    authorityLabel: "Test server",
    builtIns: new BuiltIns(counterPath, crashes),
    onHostDiagnostic: (record) => records.push(record),
    schedule: timers.schedule,
    cancelSchedule: timers.cancel,
  });
  return {
    dataRoot,
    management,
    records,
    timers,
    activations: async () => Number(await readFile(counterPath, "utf8").catch(() => "0")),
    status: () => management.hosts.statuses().find((status) => status.extensionId === EXTENSION),
    settle: async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (records.some((record) => record.transition === "failed" && record.settled !== true)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    waitForFailures: async (count) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (records.filter((record) => record.transition === "failed").length >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(`only ${records.filter((r) => r.transition === "failed").length} failures were recorded, wanted ${count}`);
    },
    cleanup: async () => {
      management.stopSupervision();
      await management.hosts.shutdown().catch(() => undefined);
      await rm(dataRoot, { recursive: true, force: true });
    },
  };
}

test("a host that crashes once is restarted on its own and publishes again", async () => {
  const value = await fixture(1);
  try {
    await value.management.initialize();
    await value.waitForFailures(1);
    assert.equal(value.status().state, "failed");
    assert.equal(value.timers.pending(), 1, "a restart is scheduled");

    await value.timers.runNext();
    assert.equal(value.status().state, "running", "the host came back without an application restart");
    assert.equal(await value.activations(), 3, "the probe, the crash, and the restart");
    assert.ok(
      value.records.some((record) => record.transition === "restart-attempted"),
      "the restart itself is recorded",
    );
  } finally {
    await value.cleanup();
  }
});

test("a supervised restart re-publishes contributions so running terminals are observed again", async () => {
  const value = await fixture(1);
  try {
    // Re-publication is what drives `reobserveExistingTerminals`, which is how
    // an already-running CLI binds again without a new terminal.
    const republished = [];
    value.management.hosts.onContributionsChanged(() => {
      republished.push(value.management.hosts.agentProviderContributions().map((provider) => provider.id));
    });
    await value.management.initialize();
    await value.waitForFailures(1);
    assert.deepEqual(value.management.hosts.agentProviderContributions(), [], "a crashed host publishes nothing");

    await value.timers.runNext();
    assert.deepEqual(
      value.management.hosts.agentProviderContributions().map((provider) => provider.id),
      [`${EXTENSION}/cli`],
      "the restarted host publishes its provider again",
    );
    assert.ok(
      republished.some((providers) => providers.includes(`${EXTENSION}/cli`)),
      "contribution listeners are notified, so existing terminals are re-observed",
    );
  } finally {
    await value.cleanup();
  }
});

test("backoff grows with consecutive failures and stops at quarantine", async () => {
  const value = await fixture(99);
  try {
    await value.management.initialize();
    await value.waitForFailures(1);
    const delays = [];
    // The host quarantines at its fifth failure inside the crash window.
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const next = value.timers.queued[0];
      assert.ok(next !== undefined, `no restart scheduled after failure ${attempt}`);
      delays.push(next.milliseconds);
      await value.timers.runNext();
      await value.waitForFailures(attempt + 1);
    }
    assert.ok(delays[1] > delays[0], "backoff grows between attempts");
    assert.equal(value.status().state, "quarantined");
    assert.equal(value.timers.pending(), 0, "a quarantined host schedules no restart");
    assert.ok(
      value.records.some((record) => record.transition === "quarantined"),
      "quarantine is recorded",
    );
  } finally {
    await value.cleanup();
  }
});

test("an explicit restart clears quarantine and starts the host", async () => {
  const value = await fixture(5);
  try {
    await value.management.initialize();
    await value.waitForFailures(1);
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await value.timers.runNext();
      await value.waitForFailures(attempt + 1);
    }
    assert.equal(value.status().state, "quarantined");

    await value.management.restart(EXTENSION);
    assert.equal(value.status().state, "running");
    assert.equal(value.status().consecutiveCrashes, 0, "the crash window is reset");
    assert.ok(
      value.records.some((record) => record.transition === "quarantine-cleared"),
      "clearing quarantine is recorded",
    );
  } finally {
    await value.cleanup();
  }
});

test("shutdown cancels a pending restart", async () => {
  const value = await fixture(99);
  try {
    await value.management.initialize();
    await value.waitForFailures(1);
    assert.equal(value.timers.pending(), 1);

    value.management.stopSupervision();
    assert.equal(value.timers.pending(), 0, "no restart survives shutdown");
    const activations = await value.activations();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await value.activations(), activations, "nothing restarted after shutdown");
  } finally {
    await value.cleanup();
  }
});

test("a deliberate stop schedules no restart", async () => {
  const value = await fixture(0);
  try {
    await value.management.initialize();
    assert.equal(value.status().state, "running");

    await value.management.hosts.stop(EXTENSION);
    assert.equal(value.status().state, "stopped");
    assert.equal(value.timers.pending(), 0, "a deliberate stop is not a failure to recover from");
  } finally {
    await value.cleanup();
  }
});
