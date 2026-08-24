import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createDefaultExtensionManagement, ExtensionInstaller } from "../dist/extensions/index.js";

const PACKAGE = "terminay-built-in-fixture";
const EXTENSION = "com.terminay.built-in-fixture";
const INTEGRITY = `sha512-${Buffer.alloc(64, 3).toString("base64")}`;

function manifest() {
  return { manifestVersion: 1, id: EXTENSION, displayName: "Built in fixture", api: "^1.0.0", engines: { terminay: ">=1", node: ">=22" }, entrypoint: "dist/extension.js", permissions: ["network"], contributes: { projectEnvironments: [{ id: `${EXTENSION}/provider`, displayName: "Fixture", capabilities: ["terminal"] }] } };
}

function tree(version, metadata = manifest()) {
  const packageJson = JSON.stringify({ name: PACKAGE, version, type: "module", exports: { ".": "./dist/extension.js" }, terminay: metadata });
  const source = `export function activate(context) { context.registerProjectEnvironmentProvider({ providerId: "${EXTENSION}/provider", displayName: "Fixture", capabilities: ["terminal"] }); }\n`;
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, [`node_modules/${PACKAGE}`]: { version, resolved: `file:${PACKAGE}-${version}.tgz`, integrity: INTEGRITY } } });
  const files = [["package-lock.json", lock], [`node_modules/${PACKAGE}/package.json`, packageJson], [`node_modules/${PACKAGE}/dist/extension.js`, source]];
  const inventory = files.map(([path, body]) => ({ path, size: Buffer.byteLength(body), hash: createHash("sha256").update(body).digest("hex") })).sort((a, b) => a.path.localeCompare(b.path));
  return { files, lock, inventoryHash: createHash("sha256").update(JSON.stringify(inventory)).digest("hex"), lockHash: createHash("sha256").update(lock).digest("hex") };
}

class BuiltIns {
  constructor(version = "1.0.0", metadata = manifest()) { this.version = version; this.metadata = metadata; this.value = tree(version, metadata); this.available = true; }
  release(version) { this.version = version; this.value = tree(version, this.metadata); }
  async list() { return this.available ? [{ extensionId: EXTENSION, packageName: PACKAGE, version: this.version, integrity: INTEGRITY, source: "built-in", manifestMetadata: this.metadata, inventoryHash: this.value.inventoryHash, lockHash: this.value.lockHash, provenance: "verified" }] : []; }
  async materialize(_artifact, root) { for (const [path, body] of this.value.files) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, body); } }
}

class Npm {
  npmVersion = "12.0.2";
  async resolve(packageName, selector) { assert.equal(packageName, PACKAGE); const version = selector === "latest" ? "2.0.0" : selector; return { packageName, version, integrity: INTEGRITY, tarballUrl: `https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE}-${version}.tgz`, manifestMetadata: manifest() }; }
  async materialize(resolution, root) {
    const value = tree(resolution.version);
    for (const [path, body] of value.files) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, path === "package-lock.json" ? body.replace(`file:${PACKAGE}-${resolution.version}.tgz`, resolution.tarballUrl) : body);
    }
  }
}

async function fixture(metadata = manifest()) {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-built-in-installer-"));
  const npm = new Npm(); const builtIns = new BuiltIns("1.0.0", metadata);
  return { dataRoot, builtIns, installer: new ExtensionInstaller({ dataRoot, registryClient: npm, materializer: npm, builtIns }), cleanup: () => rm(dataRoot, { recursive: true, force: true }) };
}

test("offline built-ins materialize once, enable by default, and preserve disablement", async () => {
  const value = await fixture();
  try {
    let state = await value.installer.initialize();
    assert.equal(state.extensions[EXTENSION].enabled, true);
    assert.equal(state.extensions[EXTENSION].slots[state.extensions[EXTENSION].activeSlotId].receipt.source, "built-in");
    const revision = state.revision;
    state = await value.installer.reconcileBuiltIns();
    assert.equal(state.revision, revision, "an unchanged release inventory is idempotent");
    await value.installer.disable(EXTENSION);
    const restarted = new ExtensionInstaller({ dataRoot: value.dataRoot, registryClient: new Npm(), materializer: new Npm(), builtIns: value.builtIns });
    state = await restarted.initialize();
    assert.equal(state.extensions[EXTENSION].enabled, false);
    await assert.rejects(restarted.remove(EXTENSION), /rollback floor/u);
  } finally { await value.cleanup(); }
});

test("post-start reconciliation hot-activates a newly materialized enabled built-in before it is reported installed", async () => {
  const value = await fixture();
  try {
    value.builtIns.available = false;
    const management = createDefaultExtensionManagement({ dataRoot: value.dataRoot, authorityLabel: "Test server", builtIns: value.builtIns });
    await management.initialize();
    assert.deepEqual(management.hosts.providerDefinitions(), []);

    value.builtIns.available = true;
    // The installer is also used by release/runtime recovery paths, so its
    // public reconciliation method must retain the selected-server hook.
    const state = await management.installer.reconcileBuiltIns();
    assert.equal(state.extensions[EXTENSION].state, "installed");
    assert.equal(state.extensions[EXTENSION].enabled, true);
    assert.deepEqual(management.hosts.providerDefinitions().map(({ providerId }) => providerId), [`${EXTENSION}/provider`]);
    await management.hosts.shutdown();
  } finally { await value.cleanup(); }
});

test("an external npm version overrides a bundled floor and remove restores the floor without changing enablement", async () => {
  const value = await fixture();
  try {
    await value.installer.initialize();
    const preview = await value.installer.preview(`${PACKAGE}@2.0.0`);
    let state = await value.installer.confirm(preview.previewDigest);
    assert.equal(state.extensions[EXTENSION].slots[state.extensions[EXTENSION].activeSlotId].version, "2.0.0");
    state = await value.installer.remove(EXTENSION);
    assert.equal(state.extensions[EXTENSION].slots[state.extensions[EXTENSION].activeSlotId].version, "1.0.0");
    assert.equal(state.extensions[EXTENSION].enabled, true);
  } finally { await value.cleanup(); }
});

test("a disabled override survives a newer bundled reconciliation and removal selects that newer floor", async () => {
  const value = await fixture();
  try {
    await value.installer.initialize();
    await value.installer.disable(EXTENSION);
    const preview = await value.installer.preview(`${PACKAGE}@2.0.0`);
    await value.installer.confirm(preview.previewDigest);
    value.builtIns.release("1.1.0");
    const restarted = new ExtensionInstaller({ dataRoot: value.dataRoot, registryClient: new Npm(), materializer: new Npm(), builtIns: value.builtIns });
    let state = await restarted.initialize();
    let record = state.extensions[EXTENSION];
    assert.equal(record.enabled, false);
    assert.equal(record.slots[record.activeSlotId].version, "2.0.0");
    assert.ok(Object.values(record.slots).some((slot) => slot.version === "1.1.0" && slot.receipt.source === "built-in"));
    state = await restarted.remove(EXTENSION);
    record = state.extensions[EXTENSION];
    assert.equal(record.enabled, false);
    assert.equal(record.slots[record.activeSlotId].version, "1.1.0");
    assert.equal(Object.keys(record.slots).length, 2);
  } finally { await value.cleanup(); }
});

test("a malformed built-in is recorded as an isolated failure and never calls npm", async () => {
  const value = await fixture();
  try {
    const materialize = value.builtIns.materialize.bind(value.builtIns);
    value.builtIns.materialize = async (artifact, root) => { await materialize(artifact, root); await writeFile(join(root, "node_modules", PACKAGE, "dist", "extension.js"), "tampered\n"); };
    const state = await value.installer.initialize();
    assert.equal(state.extensions[EXTENSION].state, "failed");
    assert.equal(state.extensions[EXTENSION].enabled, true);
    assert.equal(Object.keys(state.extensions[EXTENSION].slots).length, 0);
  } finally { await value.cleanup(); }
});

test("a release built-in repairs a legacy failed identity conflict and preserves disablement", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.dataRoot, "extensions"), { recursive: true });
    await writeFile(join(value.dataRoot, "extensions", "registry.v1.json"), `${JSON.stringify({
      schemaVersion: 1,
      revision: 7,
      extensions: {
        [EXTENSION]: {
          extensionId: EXTENSION,
          packageName: "legacy-manual-agent-package",
          state: "failed",
          enabled: false,
          slots: {},
          failureClass: "legacy manual installation failed",
        },
      },
    }, null, 2)}\n`);

    const state = await value.installer.initialize();
    const record = state.extensions[EXTENSION];
    assert.equal(record.packageName, PACKAGE);
    assert.equal(record.state, "disabled");
    assert.equal(record.enabled, false);
    assert.equal(record.failureClass, undefined);
    assert.equal(record.slots[record.activeSlotId].receipt.source, "built-in");
  } finally { await value.cleanup(); }
});

test("non-conformant and version-incompatible bundled metadata fail in isolation", async () => {
  const incompatible = { ...manifest(), api: "^999.0.0", engines: { terminay: ">=999", node: ">=999" } };
  const value = await fixture(incompatible);
  try {
    const state = await value.installer.initialize();
    assert.equal(state.extensions[EXTENSION].state, "failed");
    assert.equal(state.extensions[EXTENSION].enabled, true);
    assert.equal(Object.keys(state.extensions[EXTENSION].slots).length, 0);
  } finally { await value.cleanup(); }
});
