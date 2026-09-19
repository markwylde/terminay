import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bundledNpmCliPath, ExtensionInstaller, OFFICIAL_EXTENSION_CATALOGUE, parsePublicNpmSpec } from "../dist/extensions/index.js";

const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;
function resolution(version = "1.0.0") { return { packageName: "fixture-extension", version, integrity: INTEGRITY, tarballUrl: `https://registry.npmjs.org/fixture-extension/-/fixture-extension-${version}.tgz`, provenance: "unavailable", manifestMetadata: packageJson(version).terminay }; }
function packageJson(version, extra = {}) { return {
  name: "fixture-extension", version, type: "module", exports: { ".": "./dist/extension.js" },
  terminay: { manifestVersion: 1, id: "dev.example.fixture", displayName: "Fixture", api: "^3.0.0", engines: { terminay: ">=1", node: ">=22" }, entrypoint: "dist/extension.js", permissions: ["agent-observation"], contributes: { agentSessionSources: [{ id: "dev.example.fixture/agents", displayName: "Fixture", harnesses: [{ id: "fixture", displayName: "Fixture" }] }] }, },
  ...extra,
}; }

class FixtureNpm {
  npmVersion = "12.0.2";
  versions = new Map([["latest", "1.0.0"]]);
  extraPackage = {};
  /** Dependency packages materialized beside the extension, keyed by name. */
  dependencies = {};
  invalidLock = false;
  async resolve(packageName, selector) { assert.equal(packageName, "fixture-extension"); return resolution(this.versions.get(selector) ?? selector); }
  async materialize(value, root) {
    await mkdir(join(root, "node_modules", "fixture-extension", "dist"), { recursive: true });
    await writeFile(join(root, "node_modules", "fixture-extension", "package.json"), JSON.stringify(packageJson(value.version, this.extraPackage)));
    await writeFile(join(root, "node_modules", "fixture-extension", "dist", "extension.js"), "export default { activate() {} };\n");
    const packages = { "": {}, "node_modules/fixture-extension": { version: value.version, resolved: value.tarballUrl, integrity: this.invalidLock ? undefined : value.integrity } };
    for (const [name, { packageJson: dependencyJson, files = {}, hasInstallScript }] of Object.entries(this.dependencies)) {
      const directory = join(root, "node_modules", name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "package.json"), JSON.stringify({ name, version: "2.0.0", ...dependencyJson }));
      for (const [path, contents] of Object.entries(files)) {
        await mkdir(join(directory, path, ".."), { recursive: true });
        await writeFile(join(directory, path), contents);
      }
      packages[`node_modules/${name}`] = { version: "2.0.0", resolved: `https://registry.npmjs.org/${name}/-/${name}-2.0.0.tgz`, integrity: INTEGRITY, optional: true, ...(hasInstallScript ? { hasInstallScript: true } : {}) };
    }
    await writeFile(join(root, "package-lock.json"), JSON.stringify({ name: "terminay-extension-stage", lockfileVersion: 3, packages }));
  }
}

async function harness(options = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-extension-installer-"));
  const npm = new FixtureNpm();
  const audits = [];
  const installer = new ExtensionInstaller({ dataRoot, registryClient: npm, materializer: npm, probe: options.probe, references: options.references, audit: (event) => audits.push(event) });
  await installer.initialize();
  return { dataRoot, npm, audits, installer, cleanup: () => rm(dataRoot, { recursive: true, force: true }) };
}

test("custom npm preview binds exact metadata and commits an immutable validated slot", async () => {
  const fixture = await harness();
  try {
    const preview = await fixture.installer.preview("fixture-extension@latest");
    assert.equal(preview.version, "1.0.0");
    assert.equal(preview.official, false);
    assert.match(preview.trustedCodeWarning, /trusted code/u);
    const state = await fixture.installer.confirm(preview.previewDigest);
    const installed = state.extensions["dev.example.fixture"];
    assert.equal(installed.state, "installed"); assert.equal(installed.enabled, true);
    assert.equal(installed.slots[installed.activeSlotId].receipt.npmVersion, "12.0.2");
    assert.equal(installed.slots[installed.activeSlotId].receipt.integrity, INTEGRITY);
    assert.equal(fixture.audits.at(-1).kind, "extension.installed");
    assert.doesNotMatch(await readFile(join(fixture.dataRoot, "extensions", "registry.v1.json"), "utf8"), /trusted code/u);
  } finally { await fixture.cleanup(); }
});

test("a dependency shipping prebuilt native modules installs even though it declares an install script", async () => {
  const fixture = await harness();
  try {
    fixture.npm.dependencies = {
      "native-watch": {
        packageJson: { scripts: { install: "node fetch-prebuild.js" } },
        files: { "build/darwin_arm64/native-watch.node": "prebuilt", "build/linux_x64/native-watch.node": "prebuilt" },
        hasInstallScript: true,
      },
    };
    const preview = await fixture.installer.preview("fixture-extension@1.0.0");
    const state = await fixture.installer.confirm(preview.previewDigest);
    assert.equal(state.extensions["dev.example.fixture"].state, "installed");
  } finally { await fixture.cleanup(); }
});

test("a dependency that needs a native build, or an install script with no prebuild, is refused", async () => {
  for (const [dependency, pattern] of [
    [{ packageJson: {}, files: { "binding.gyp": "{}", "src/watch.cc": "" } }, /native builds/u],
    [{ packageJson: { scripts: { install: "node-gyp rebuild" } }, files: { "src/watch.cc": "" }, hasInstallScript: true }, /lifecycle scripts/u],
  ]) {
    const fixture = await harness();
    try {
      fixture.npm.dependencies = { "native-watch": dependency };
      const preview = await fixture.installer.preview("fixture-extension@1.0.0");
      await assert.rejects(fixture.installer.confirm(preview.previewDigest), pattern);
      assert.equal((await fixture.installer.snapshot()).extensions["dev.example.fixture"], undefined);
    } finally { await fixture.cleanup(); }
  }
});

test("failed update and interrupted staging preserve the exact active pointer", async () => {
  const fixture = await harness();
  try {
    let preview = await fixture.installer.preview("fixture-extension@1.0.0"); await fixture.installer.confirm(preview.previewDigest);
    const before = await fixture.installer.snapshot(); const active = before.extensions["dev.example.fixture"].activeSlotId;
    fixture.npm.extraPackage = { scripts: { install: "exit 1" } };
    preview = await fixture.installer.preview("fixture-extension@2.0.0");
    await assert.rejects(fixture.installer.confirm(preview.previewDigest), /lifecycle scripts/u);
    assert.equal((await fixture.installer.snapshot()).extensions["dev.example.fixture"].activeSlotId, active);
    await mkdir(join(fixture.dataRoot, "extensions", "staging", "interrupted"), { recursive: true });
    await fixture.installer.initialize();
    await assert.rejects(readFile(join(fixture.dataRoot, "extensions", "staging", "interrupted", "payload")), /ENOENT/u);
  } finally { await fixture.cleanup(); }
});

test("updates install side-by-side, defer activation while used, and rollback an exact retained slot", async () => {
  let activeUses = 0;
  const fixture = await harness({ references: async () => ({ activeUses }) });
  try {
    let preview = await fixture.installer.preview("fixture-extension@1.0.0"); let state = await fixture.installer.confirm(preview.previewDigest);
    const first = state.extensions["dev.example.fixture"].activeSlotId;
    activeUses = 2; preview = await fixture.installer.preview("fixture-extension@2.0.0"); state = await fixture.installer.confirm(preview.previewDigest);
    assert.equal(state.extensions["dev.example.fixture"].state, "pending"); assert.equal(state.extensions["dev.example.fixture"].activeSlotId, first); assert.ok(state.extensions["dev.example.fixture"].pendingSlotId);
    activeUses = 0; state = await fixture.installer.activatePending("dev.example.fixture");
    assert.notEqual(state.extensions["dev.example.fixture"].activeSlotId, first);
    state = await fixture.installer.rollback("dev.example.fixture"); assert.equal(state.extensions["dev.example.fixture"].activeSlotId, first);
  } finally { await fixture.cleanup(); }
});

test("disable/remove is reference-aware and never cascades namespaced data", async () => {
  let references = {};
  const fixture = await harness({ references: async () => references });
  try {
    const preview = await fixture.installer.preview("fixture-extension"); await fixture.installer.confirm(preview.previewDigest);
    references = { projects: 2 };
    await fixture.installer.disable("dev.example.fixture");
    await assert.rejects(fixture.installer.remove("dev.example.fixture"), /projects/u);
    const data = join(fixture.dataRoot, "extensions", "data", "dev.example.fixture"); await mkdir(data, { recursive: true }); await writeFile(join(data, "state.json"), "{}\n");
    references = {}; const state = await fixture.installer.remove("dev.example.fixture");
    assert.equal(state.extensions["dev.example.fixture"], undefined);
    assert.equal(await readFile(join(data, "state.json"), "utf8"), "{}\n");
  } finally { await fixture.cleanup(); }
});

test("hostile npm specifications, missing integrity, install scripts, and public-registry escapes fail closed", async () => {
  for (const spec of ["npm:other@1", "git+https://example.test/x", "https://example.test/x.tgz", "file:../x", "alias@npm:other@1"]) assert.throws(() => parsePublicNpmSpec(spec), /public npm|invalid public/u);
  const fixture = await harness();
  try {
    fixture.npm.invalidLock = true; let preview = await fixture.installer.preview("fixture-extension@1.0.0"); await assert.rejects(fixture.installer.confirm(preview.previewDigest), /integrity/u);
    fixture.npm.invalidLock = false; fixture.npm.extraPackage = { scripts: { postinstall: "node build.js" } }; preview = await fixture.installer.preview("fixture-extension@1.0.0"); await assert.rejects(fixture.installer.confirm(preview.previewDigest), /lifecycle/u);
  } finally { await fixture.cleanup(); }
});

test("official catalogue is hardcoded metadata without a privileged install path", () => {
  assert.deepEqual(OFFICIAL_EXTENSION_CATALOGUE.map((item) => item.packageName), ["terminay-builtin-agents", "terminay-language-typescript"]);
  assert.ok(OFFICIAL_EXTENSION_CATALOGUE.every((item) => item.official));
});

test("the installer resolves the pinned bundled npm CLI instead of a PATH command", async () => {
  const cli = bundledNpmCliPath();
  assert.match(cli, /node_modules\/npm\/bin\/npm-cli\.js$/u);
  assert.match(await readFile(cli, "utf8"), /lib\/cli\.js/u);
});
