import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { bundledNpmCliPath, createDefaultExtensionManagement, ExtensionInstaller, inspectNpmPackArchive, NpmCliRegistryClient } from "../dist/extensions/index.js";

const executeFile = promisify(execFile);
const manifest = { manifestVersion: 1, id: "dev.example.uploaded", displayName: "Uploaded fixture", api: "^1.0.0", engines: { terminay: ">=1", node: ">=22" }, entrypoint: "dist/extension.js", permissions: ["network"], contributes: { projectEnvironments: [{ id: "dev.example.uploaded/main", displayName: "Uploaded", capabilities: ["terminal", "filesystem"] }] } };

async function packedFixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-uploaded-extension-")); const source = join(root, "source"); const packs = join(root, "packs");
  await mkdir(join(source, "dist"), { recursive: true }); await mkdir(packs);
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "terminay-unpublished-fixture", version: "1.2.3", type: "module", exports: { ".": "./dist/extension.js" }, terminay: manifest }));
  await writeFile(join(source, "dist", "extension.js"), "export async function activate(context) { context.registerProjectEnvironmentProvider({ definition: { providerId: 'dev.example.uploaded/main', displayName: 'Uploaded', capabilities: ['terminal', 'filesystem'] }, runtime: { testProfile: async () => [], resolveOptions: async () => ({ options: [] }), createEnvironment: async () => ({ state: 'ready', providerState: {}, status: { state: 'available', revision: 1 } }), resumeOperation: async () => ({ state: 'ready', providerState: {}, status: { state: 'available', revision: 1 } }), getStatus: async () => ({ state: 'available', revision: 1 }), invokeAction: async () => ({ state: 'complete', providerState: {}, status: { state: 'available', revision: 1 } }) } }); }\n");
  await executeFile(process.execPath, [bundledNpmCliPath(), "pack", source, "--pack-destination", packs, "--ignore-scripts"]);
  return { root, bytes: await readFile(join(packs, "terminay-unpublished-fixture-1.2.3.tgz")), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("an npm pack archive previews as uploaded/unverified and installs through the ordinary immutable slot", async () => {
  const fixture = await packedFixture(); const dataRoot = join(fixture.root, "data"); const management = createDefaultExtensionManagement({ dataRoot, authorityLabel: "Test server" }); const installer = management.installer;
  try {
    await installer.initialize(); const inspected = await inspectNpmPackArchive(fixture.bytes); assert.equal(inspected.packageJson.name, "terminay-unpublished-fixture");
    const preview = await installer.previewArchive("terminay-unpublished-fixture-1.2.3.tgz", fixture.bytes);
    assert.equal(preview.source, "uploaded"); assert.equal(preview.official, false); assert.equal(preview.provenance, "unverified"); assert.match(preview.integrity, /^sha512-/u);
    const state = await installer.confirm(preview.previewDigest); const installed = state.extensions[manifest.id]; assert.equal(installed.packageName, "terminay-unpublished-fixture"); assert.equal(installed.slots[installed.activeSlotId].receipt.integrity, preview.integrity);
    await management.activate(manifest.id); assert.deepEqual(management.hosts.providerDefinitions().map(({ providerId }) => providerId), ["dev.example.uploaded/main"]);
    await management.hosts.shutdown(); await management.activateEnabled(); assert.deepEqual(management.hosts.providerDefinitions().map(({ providerId }) => providerId), ["dev.example.uploaded/main"]);
  } finally { await management.hosts.shutdown(); await fixture.cleanup(); }
});

test("uploaded package inspection rejects invalid names and malformed or oversized bytes before preview", async () => {
  const fixture = await packedFixture(); const dataRoot = join(fixture.root, "data"); const npm = new NpmCliRegistryClient({ workRoot: join(dataRoot, "npm") }); const installer = new ExtensionInstaller({ dataRoot, registryClient: npm, materializer: npm });
  try {
    await installer.initialize(); await assert.rejects(installer.previewArchive("fixture.zip", fixture.bytes), /\.tgz/u);
    await assert.rejects(inspectNpmPackArchive(Buffer.from("not gzip")), /gzip/u);
    await assert.rejects(inspectNpmPackArchive(Buffer.alloc(12 * 1024 * 1024 + 1)), /12 MiB/u);
  } finally { await fixture.cleanup(); }
});
