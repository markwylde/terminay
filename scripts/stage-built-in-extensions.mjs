#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { stageProductionDependencyClosure } from "./standalone-runtime-dependencies.mjs";
import { parseSingleNpmPackResult } from "./npm-pack-result.mjs";

const runFile = promisify(execFile);
const repository = resolve(new URL("..", import.meta.url).pathname);
const npmCli = join(repository, "node_modules", "npm", "bin", "npm-cli.js");
const SDK = "@terminay/extension-api";
const expectedIds = new Set(["com.terminay.ssh", "com.puzed.platform", "com.terminay.agent.codex", "com.terminay.agent.claude-code", "com.terminay.agent.cursor", "com.terminay.agent.grok", "com.terminay.agent.omp"]);

/** Build, test, pack, and stage every official extension as a complete
 * offline npm-like tree. Both Electron and standalone copy this exact output;
 * they must never resolve a built-in from npm at runtime. */
export async function stageBuiltInExtensions(options = {}) {
  const root = resolve(options.root ?? repository);
  const output = resolve(root, options.outputDirectory ?? "build/built-in-extensions");
  const catalogue = await loadCatalogue(join(root, "extensions", "builtins.json"));
  const temporary = await mkdtemp(join(tmpdir(), "terminay-built-in-stage-"));
  const next = `${output}.next`;
  try {
    await npm(root, ["run", "build:built-in-extension-workspaces"]);
    if (!options.skipChecks) await testBuiltInExtensions(root, catalogue);
    const packs = join(temporary, "packs");
    await mkdir(packs);
    const sdk = await pack(root, SDK, packs, true);
    const rootLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    const artifacts = [];
    await rm(next, { recursive: true, force: true });
    await mkdir(join(next, "artifacts"), { recursive: true });
    for (const entry of catalogue) {
      const archive = await pack(root, entry.packageName, packs, true);
      const artifactDirectory = join(next, "artifacts", entry.extensionId);
      await mkdir(artifactDirectory, { recursive: true });
      await cp(archive.path, join(artifactDirectory, "package.tgz"));
      await cp(sdk.path, join(artifactDirectory, "extension-api.tgz"));
      await unpack(archive.path, join(artifactDirectory, "node_modules"), entry.packageName);
      await unpack(sdk.path, join(artifactDirectory, "node_modules"), SDK);
      const packageJson = JSON.parse(await readFile(join(artifactDirectory, "node_modules", ...entry.packageName.split("/"), "package.json"), "utf8"));
      assertPackage(entry, packageJson);
      const dependencies = Object.keys(packageJson.dependencies ?? {}).sort();
      const copied = dependencies.length === 0 ? [] : await stageProductionDependencyClosure({
        destinationModules: join(artifactDirectory, "node_modules"),
        runtimeModules: join(root, "node_modules"),
        rootPackages: dependencies,
      });
      // npm pack applies ignore rules recursively, including to dependency
      // trees nested below this package's dist directory. Strip npm's own
      // ignore control files before inventorying so the verified tree is
      // byte-identical after the standalone server itself is packed.
      await removeNestedNpmIgnoreFiles(join(artifactDirectory, "node_modules"));
      // The public SDK is a peer dependency of official packages but is always
      // bundled as a verified local dependency so child hosts cannot inherit a
      // workspace symlink or a server-level node_modules tree.
      await writeFile(join(artifactDirectory, "package-lock.json"), `${JSON.stringify(lockForArtifact(rootLock, packageJson, archive, sdk, copied), null, 2)}\n`);
      const tree = await inventoryTree(artifactDirectory);
      const lockHash = sha256(await readFile(join(artifactDirectory, "package-lock.json")));
      artifacts.push(Object.freeze({ extensionId: entry.extensionId, packageName: entry.packageName, version: packageJson.version, integrity: archive.integrity, manifestMetadata: packageJson.terminay, directory: `artifacts/${entry.extensionId}`, inventoryHash: sha256(JSON.stringify(tree.map(({ path, size, sha256: hash }) => ({ path, size, hash })))), lockHash, localDependencies: [SDK], files: tree }));
    }
    const inventory = Object.freeze({ schemaVersion: 1, artifacts: artifacts.sort((left, right) => left.extensionId.localeCompare(right.extensionId)) });
    await writeFile(join(next, "inventory.v1.json"), `${JSON.stringify(inventory, null, 2)}\n`);
    await assertRegularTree(next);
    await rm(output, { recursive: true, force: true });
    await mkdir(dirname(output), { recursive: true });
    await rename(next, output);
    return Object.freeze({ outputDirectory: output, inventory });
  } catch (error) {
    await rm(next, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function testBuiltInExtensions(root, catalogue) {
  for (const entry of catalogue) {
    await npm(root, ["run", "test:ci", "--workspace", entry.packageName]);
  }
}

async function pack(root, workspace, destination) {
  const { stdout } = await runFile(process.execPath, [npmCli, "pack", "--workspace", workspace, "--json", "--pack-destination", destination, "--ignore-scripts"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const result = parseSingleNpmPackResult(stdout);
  if (typeof result.filename !== "string" || typeof result.integrity !== "string") throw new Error(`npm pack result for ${workspace} is invalid`);
  return Object.freeze({ path: join(destination, result.filename), integrity: result.integrity });
}

async function unpack(archive, modules, packageName) {
  const temporary = await mkdtemp(join(tmpdir(), "terminay-built-in-unpack-"));
  try {
    await mkdir(modules, { recursive: true });
    await runFile("tar", ["-xzf", archive, "-C", temporary]);
    await cp(join(temporary, "package"), join(modules, ...packageName.split("/")), { recursive: true, dereference: false, errorOnExist: true });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

function lockForArtifact(rootLock, packageJson, pack, sdk, copied) {
  const packages = { "": {} };
  packages[`node_modules/${packageJson.name}`] = { version: packageJson.version, resolved: "file:package.tgz", integrity: pack.integrity };
  const sdkPackage = rootLock.packages?.["packages/extension-api"];
  if (sdkPackage === undefined || typeof sdkPackage.version !== "string") throw new Error("public Extension API workspace package is missing from lockfile");
  packages[`node_modules/${SDK}`] = { version: sdkPackage.version, resolved: "file:extension-api.tgz", integrity: sdk.integrity };
  for (const name of copied) {
    if (name === SDK) continue;
    const source = rootLock.packages?.[`node_modules/${name}`];
    if (!source || typeof source.version !== "string" || typeof source.integrity !== "string" || typeof source.resolved !== "string") throw new Error(`staged production dependency is not locked: ${name}`);
    packages[`node_modules/${name}`] = { version: source.version, resolved: source.resolved, integrity: source.integrity };
  }
  return { name: "terminay-built-in-extension-stage", lockfileVersion: 3, packages };
}

async function inventoryTree(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`built-in artifact contains symlink: ${path}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) { const bytes = await readFile(absolute); files.push({ path, size: bytes.byteLength, sha256: sha256(bytes) }); }
      else throw new Error(`built-in artifact contains non-regular entry: ${path}`);
    }
  }
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function assertRegularTree(root) {
  for (const entry of await inventoryTree(root)) void entry;
}

async function removeNestedNpmIgnoreFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) await removeNestedNpmIgnoreFiles(absolute);
    else if (entry.isFile() && entry.name === ".npmignore") await rm(absolute);
  }
}

async function loadCatalogue(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.schemaVersion !== 1 || !Array.isArray(value.extensions) || value.extensions.length !== 7) throw new Error("built-in extension catalogue must name exactly seven extensions");
  const entries = value.extensions.map((entry) => {
    if (!entry || typeof entry.directory !== "string" || typeof entry.extensionId !== "string" || typeof entry.packageName !== "string" || !/^[a-z0-9][a-z0-9._-]{0,126}$/u.test(entry.extensionId) || entry.directory.includes("/") || entry.directory.includes("\\") || entry.directory === "." || entry.directory === "..") throw new Error("built-in extension catalogue entry is invalid");
    return Object.freeze({ directory: entry.directory, extensionId: entry.extensionId, packageName: entry.packageName });
  });
  if (new Set(entries.map((entry) => entry.extensionId)).size !== 7 || new Set(entries.map((entry) => entry.packageName)).size !== 7 || !entries.every((entry) => expectedIds.has(entry.extensionId))) throw new Error("built-in extension catalogue does not match the official inventory");
  return entries;
}

function assertPackage(entry, packageJson) {
  if (packageJson?.name !== entry.packageName || typeof packageJson.version !== "string" || packageJson.terminay?.id !== entry.extensionId) throw new Error(`packed built-in package identity differs from catalogue: ${entry.packageName}`);
  if (!Array.isArray(packageJson.files) || packageJson.files.includes("src")) throw new Error(`built-in package has an unsafe pack policy: ${entry.packageName}`);
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function npm(cwd, argumentsValue) { return runFile(process.execPath, [npmCli, ...argumentsValue], { cwd, maxBuffer: 16 * 1024 * 1024 }); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const skipChecks = process.argv.includes("--skip-checks");
  const index = process.argv.indexOf("--output-dir");
  if (index !== -1 && process.argv[index + 1] === undefined) throw new Error("--output-dir requires a value");
  const result = await stageBuiltInExtensions({ skipChecks, ...(index === -1 ? {} : { outputDirectory: process.argv[index + 1] }) });
  process.stdout.write(`${JSON.stringify({ outputDirectory: result.outputDirectory, extensions: result.inventory.artifacts.map((artifact) => `${artifact.packageName}@${artifact.version}`) }, null, 2)}\n`);
}
