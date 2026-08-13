import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExtensionInstaller } from "../dist/extensions/index.js";

const INTEGRITY = `sha512-${Buffer.alloc(64, 11).toString("base64")}`;

function packageJson(version) {
  return { name: "upgrade-fixture", version, type: "module", exports: { ".": "./dist/extension.js" }, terminay: { manifestVersion: 1, id: "dev.example.upgrade", displayName: "Upgrade", api: "^1.0.0", engines: { terminay: ">=1", node: ">=22" }, entrypoint: "dist/extension.js", permissions: ["data:read", "data:write"], contributes: { projectEnvironments: [{ id: "dev.example.upgrade/server", displayName: "Server", capabilities: ["terminal"] }] } } };
}

class UpgradeNpm {
  npmVersion = "12.0.2";
  async resolve(packageName, version) { return { packageName, version, integrity: INTEGRITY, tarballUrl: `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`, manifestMetadata: packageJson(version).terminay }; }
  async materialize(resolution, root) {
    const packageRoot = join(root, "node_modules", resolution.packageName);
    await mkdir(join(packageRoot, "dist"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify(packageJson(resolution.version)));
    await writeFile(join(packageRoot, "dist", "extension.js"), "export function activate() {}\n");
    await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, [`node_modules/${resolution.packageName}`]: { version: resolution.version, resolved: resolution.tarballUrl, integrity: resolution.integrity } } }));
  }
}

async function install(installer, version) {
  const preview = await installer.preview(`upgrade-fixture@${version}`);
  return installer.confirm(preview.previewDigest);
}

test("server upgrade snapshots and migrates extension data before changing the active slot", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-extension-upgrade-"));
  const migrations = [];
  const installer = new ExtensionInstaller({ dataRoot, registryClient: new UpgradeNpm(), materializer: new UpgradeNpm(), migrateData: async (input) => { migrations.push(input); const state = JSON.parse(await readFile(join(input.dataRoot, "state.json"), "utf8")); await writeFile(join(input.dataRoot, "state.json"), JSON.stringify({ ...state, schema: 2 })); } });
  try {
    await installer.initialize();
    await install(installer, "1.0.0");
    const providerData = join(dataRoot, "extensions", "data", "dev.example.upgrade");
    await mkdir(providerData, { recursive: true });
    await writeFile(join(providerData, "state.json"), JSON.stringify({ schema: 1, binding: "opaque" }));
    const updated = await install(installer, "2.0.0");
    assert.equal(updated.extensions["dev.example.upgrade"].slots[updated.extensions["dev.example.upgrade"].activeSlotId].version, "2.0.0");
    assert.deepEqual(migrations.map(({ extensionId, fromVersion, toVersion }) => ({ extensionId, fromVersion, toVersion })), [{ extensionId: "dev.example.upgrade", fromVersion: "1.0.0", toVersion: "2.0.0" }]);
    assert.deepEqual(JSON.parse(await readFile(join(providerData, "state.json"), "utf8")), { schema: 2, binding: "opaque" });
    assert.deepEqual(JSON.parse(await readFile(join(dataRoot, "extensions", "data-snapshots", "dev.example.upgrade", "2", "state.json"), "utf8")), { schema: 1, binding: "opaque" });
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test("failed migration restores data and old code, while restart retains the unavailable project provider record", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-extension-upgrade-fail-"));
  const npm = new UpgradeNpm();
  const installer = new ExtensionInstaller({ dataRoot, registryClient: npm, materializer: npm, migrateData: async ({ dataRoot: providerData }) => { await writeFile(join(providerData, "state.json"), "corrupt"); throw new Error("migration rejected"); } });
  try {
    await installer.initialize();
    const initial = await install(installer, "1.0.0");
    const active = initial.extensions["dev.example.upgrade"].activeSlotId;
    const providerData = join(dataRoot, "extensions", "data", "dev.example.upgrade");
    await mkdir(providerData, { recursive: true });
    await writeFile(join(providerData, "state.json"), "known-good");
    await assert.rejects(install(installer, "2.0.0"), /migration rejected/);
    assert.equal((await installer.snapshot()).extensions["dev.example.upgrade"].activeSlotId, active);
    assert.equal(await readFile(join(providerData, "state.json"), "utf8"), "known-good");

    await installer.setFailureState("dev.example.upgrade", "incompatible", "API major mismatch");
    const restarted = new ExtensionInstaller({ dataRoot, registryClient: npm, materializer: npm });
    const restored = await restarted.initialize();
    assert.equal(restored.extensions["dev.example.upgrade"].state, "incompatible");
    assert.equal(restored.extensions["dev.example.upgrade"].activeSlotId, active);
    assert.equal((await restarted.diagnostics())[0].failureClass, "api_major_mismatch");
    const backup = await restarted.backupManifest();
    assert.equal(backup.receipts.length >= 1, true);
    await access(backup.registry);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});

test("a rollback probe failure cannot move the active pointer", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-extension-rollback-"));
  const npm = new UpgradeNpm();
  let rejectOld = false;
  const installer = new ExtensionInstaller({ dataRoot, registryClient: npm, materializer: npm, probe: async ({ manifest }) => { if (rejectOld && manifest.engines.terminay === ">=1") throw new Error("old activation failed"); } });
  try {
    await installer.initialize();
    await install(installer, "1.0.0");
    const updated = await install(installer, "2.0.0");
    const active = updated.extensions["dev.example.upgrade"].activeSlotId;
    rejectOld = true;
    await assert.rejects(installer.rollback("dev.example.upgrade"), /old activation failed/);
    assert.equal((await installer.snapshot()).extensions["dev.example.upgrade"].activeSlotId, active);
  } finally { await rm(dataRoot, { recursive: true, force: true }); }
});
