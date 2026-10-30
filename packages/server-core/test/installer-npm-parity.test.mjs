import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { NpmRegistryClient } from "../dist/extensions/index.js";

// The installer replaced `npm install --package-lock-only` and `npm ci` with
// npm's own libraries (ADR-0080). This keeps it honest against the toolchain
// npm: same lock entries, same installed files. Registry fixtures need network
// and run only with TERMINAY_NETWORK_TESTS=1.
const executeFile = promisify(execFile);
const worker = new URL("../dist/extensions/installerWorker.js", import.meta.url).pathname;
const npmExecPath = process.env.npm_execpath;
const npmCommand = typeof npmExecPath === "string" && /\.[cm]?js$/u.test(npmExecPath) ? [process.execPath, npmExecPath] : ["npm"];
const network = process.env.TERMINAY_NETWORK_TESTS === "1";

async function npm(cwd, args, cache) {
  const [file, ...prefix] = npmCommand;
  await executeFile(file, [...prefix, ...args, "--registry", "https://registry.npmjs.org/", "--cache", cache, "--userconfig", join(cache, "npmrc")], { cwd, env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" }, maxBuffer: 8 * 1024 * 1024 });
}

async function cliInstall(root, resolution) {
  const stage = join(root, "cli"); const cache = join(root, "cli-cache");
  await mkdir(stage); await mkdir(cache); await writeFile(join(cache, "npmrc"), "");
  const dependency = resolution.source === "uploaded" ? resolution.archivePath : resolution.version;
  await writeFile(join(stage, "package.json"), `${JSON.stringify({ private: true, dependencies: { [resolution.packageName]: dependency } }, null, 2)}\n`);
  const spec = resolution.source === "uploaded" ? resolution.archivePath : `${resolution.packageName}@${resolution.version}`;
  await npm(stage, ["install", spec, "--save-exact", "--package-lock-only", "--ignore-scripts", "--omit=dev", "--no-bin-links", "--workspaces=false"], cache);
  await npm(stage, ["ci", "--ignore-scripts", "--omit=dev", "--workspaces=false", "--no-bin-links"], cache);
  return stage;
}

async function libraryInstall(root, resolution) {
  const stage = join(root, "library");
  await new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "parity", workerEntrypoint: worker }).materialize(resolution, stage);
  return stage;
}

/** Lock entries by path, keeping only fields that decide what is installed. */
async function lockEntries(stage) {
  const lock = JSON.parse(await readFile(join(stage, "package-lock.json"), "utf8"));
  return Object.fromEntries(Object.entries(lock.packages).filter(([path]) => path !== "").map(([path, entry]) => [path, {
    version: entry.version, integrity: entry.integrity, resolved: entry.resolved?.startsWith("file:") ? "file:" : entry.resolved,
    optional: entry.optional ?? false, hasInstallScript: entry.hasInstallScript ?? false, bin: entry.bin ?? null,
  }]));
}

async function inventory(directory, root = directory) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (relative(root, path) === ".package-lock.json") continue;
    if (entry.isDirectory()) Object.assign(files, await inventory(path, root));
    else files[relative(root, path)] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return files;
}

async function assertParity(resolution, root) {
  const [cli, library] = [await cliInstall(root, resolution), await libraryInstall(root, resolution)];
  assert.deepEqual(await lockEntries(library), await lockEntries(cli));
  assert.deepEqual(await inventory(join(library, "node_modules")), await inventory(join(cli, "node_modules")));
}

async function uploadedArchive(root, packageJson, files = {}) {
  const source = join(root, "source"); await mkdir(source);
  await writeFile(join(source, "package.json"), JSON.stringify(packageJson));
  for (const [name, text] of Object.entries(files)) await writeFile(join(source, name), text);
  const archivePath = join(root, `${packageJson.name}-${packageJson.version}.tgz`);
  const load = createRequire(import.meta.url);
  await load("pacote").tarball.file(source, archivePath, { Arborist: load("@npmcli/arborist"), ignoreScripts: true, cache: join(root, "pack-cache") });
  const integrity = `sha512-${createHash("sha512").update(await readFile(archivePath)).digest("base64")}`;
  return { packageName: packageJson.name, version: packageJson.version, integrity, source: "uploaded", archivePath };
}

async function withRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "terminay-installer-parity-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("an uploaded archive with a bin and an install script installs identically to npm", () => withRoot(async (root) => {
  const resolution = await uploadedArchive(root, { name: "parity-fixture", version: "1.0.0", bin: { parity: "cli.js" }, scripts: { install: "node -e \"process.exit(1)\"" } }, { "cli.js": "#!/usr/bin/env node\n", "index.js": "export {};\n" });
  await assertParity(resolution, root);
}));

for (const [packageName, version] of [["chalk", "5.6.2"], ["debug", "4.4.3"], ["esbuild", "0.28.2"]]) {
  test(`${packageName}@${version} from npmjs locks and installs identically to npm`, { skip: !network && "set TERMINAY_NETWORK_TESTS=1" }, () => withRoot(async (root) => {
    const resolved = await new NpmRegistryClient({ workRoot: join(root, "resolve"), installerVersion: "parity", workerEntrypoint: worker }).resolve(packageName, version);
    await assertParity(resolved, root);
  }));
}
