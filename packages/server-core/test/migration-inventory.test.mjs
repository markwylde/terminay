import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { inspectLegacyMigration } from "../dist/migration/index.js";

test("migration inventory versions stores and preserves project/recording paths in place", async () => {
  const root = await mkdtemp(join("/tmp", "terminay-migration-inventory-"));
  const projectRoot = join(root, "project");
  const recordingsRoot = join(root, "recordings");
  await mkdir(projectRoot);
  await mkdir(recordingsRoot);

  const inventory = await inspectLegacyMigration({
    sourceVersion: "0.8.4",
    settings: { shell: { program: "/bin/zsh" } },
    macros: [{ id: "macro-1" }],
    safeStorage: { encrypted: [{ id: "provider-key", ciphertext: "must-not-be-in-inventory" }] },
    remoteDevices: [{ id: "device-1" }],
    auditRecords: [{ event: "import" }],
    tlsPaths: ["/tmp/tls.pem"],
    connectionProfiles: [{ id: "local" }],
    projects: [{ id: "p1", rootPath: projectRoot }, { id: "p2", rootPath: join(root, "gone") }],
    recordings: [{ id: "r1", recordingRoot: recordingsRoot }, { id: "r2", path: join(root, "missing.cast") }, { id: "r3", path: "relative.cast" }],
  }, { sourceSchemaVersion: 0 });

  assert.equal(inventory.sourceVersion, "0.8.4");
  assert.equal(inventory.sourceSchemaVersion, 0);
  assert.equal(inventory.destinationSchemaVersion, 1);
  assert.deepEqual(inventory.stores.find((store) => store.name === "safeStorageSecrets"), {
    name: "safeStorageSecrets", present: true, entries: 1,
  });
  assert.deepEqual(inventory.storeVersions.find((store) => store.name === "settings"), {
    name: "settings", format: "legacy", schemaVersion: null, version: null,
  });
  assert.deepEqual(inventory.storeVersions.find((store) => store.name === "safeStorageSecrets"), {
    name: "safeStorageSecrets", format: "legacy", schemaVersion: null, version: null,
  });
  assert.equal(inventory.projectPaths.length, 2);
  assert.equal(inventory.projectPaths[0].state, "available");
  assert.equal(inventory.projectPaths[0].preservedInPlace, true);
  assert.equal(inventory.projectPaths[1].state, "missing");
  assert.equal(inventory.projectPaths[1].reason, "not-found");
  assert.equal(inventory.recordingPaths.find((entry) => entry.path === recordingsRoot)?.kind, "recording");
  assert.equal(inventory.recordingPaths.find((entry) => entry.path === join(root, "missing.cast"))?.state, "missing");
  assert.equal(inventory.recordingPaths.find((entry) => entry.path === "relative.cast")?.reason, "not-absolute");
  assert.equal(inventory.rendererLayout.recoverable, false);
  assert.equal(JSON.stringify(inventory).includes("must-not-be-in-inventory"), false);

  const legacySecrets = await inspectLegacyMigration({ secrets: { one: "ciphertext" } }, { pathProbe: () => "missing" });
  assert.deepEqual(legacySecrets.stores.find((store) => store.name === "safeStorageSecrets"), {
    name: "safeStorageSecrets", present: true, entries: 1,
  });
});

test("migration inventory detects supported legacy aliases and bounded store versions without payloads", async () => {
  const source = {
    desktopVersion: "0.7.3",
    preferences: { schemaVersion: 0, shell: { program: "/bin/zsh" } },
    macroDefinitions: { version: "1.2.0", macros: [{ id: "macro-1", template: "echo hi" }] },
    safeStorage: { schemaVersion: 4, encrypted: [{ id: "provider", ciphertext: "do-not-copy" }] },
    deviceKeys: { version: 2, entries: [{ id: "device-1", key: "do-not-copy" }] },
    auditLog: { schemaVersion: 1, entries: [{ event: "import" }] },
    tlsConfig: { version: 1, paths: ["/tmp/tls.pem"] },
    profiles: { version: "1", entries: [{ id: "remote-1" }] },
    projectRoots: { version: 1, entries: [{ rootPath: "/tmp/project" }] },
    recordingRoots: { schemaVersion: 1, entries: [{ path: "/tmp/recordings" }] },
  };
  const first = await inspectLegacyMigration(source, { pathProbe: () => "missing" });
  const second = await inspectLegacyMigration(source, { pathProbe: () => "missing" });
  assert.deepEqual(first, second, "preflight is deterministic and idempotent");
  assert.equal(first.sourceVersion, "0.7.3");
  assert.deepEqual(first.storeVersions.find((store) => store.name === "settings"), {
    name: "settings", format: "versioned", schemaVersion: 0, version: null,
  });
  assert.deepEqual(first.storeVersions.find((store) => store.name === "macros"), {
    name: "macros", format: "versioned", schemaVersion: null, version: "1.2.0",
  });
  assert.deepEqual(first.storeVersions.find((store) => store.name === "remoteDevices"), {
    name: "remoteDevices", format: "versioned", schemaVersion: null, version: "2",
  });
  assert.deepEqual(first.storeVersions.find((store) => store.name === "recordings"), {
    name: "recordings", format: "versioned", schemaVersion: 1, version: null,
  });
  assert.equal(JSON.stringify(first).includes("do-not-copy"), false);
});

test("migration inventory is bounded and reports renderer-only state as unrecoverable", async () => {
  const probed = [];
  const source = { projects: Array.from({ length: 20 }, (_, index) => ({ rootPath: `/project/${index}` })) };
  const inventory = await inspectLegacyMigration(source, {
    maxPathReferences: 3,
    pathProbe: (path) => { probed.push(path); return "available"; },
  });
  assert.equal(inventory.projectPaths.length, 3);
  assert.deepEqual(probed, ["/project/0", "/project/1", "/project/2"]);
  assert.deepEqual(inventory.rendererLayout, { recoverable: false, reason: "renderer-only-layout-not-persisted" });
});

test("migration inventory rejects an invalid source and path limit", async () => {
  await assert.rejects(inspectLegacyMigration([]), /source is not an object/);
  await assert.rejects(inspectLegacyMigration({}, { maxPathReferences: 0 }), /maxPathReferences must be between/);
});
