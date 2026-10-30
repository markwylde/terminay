import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installerLibraryOptions, NpmRegistryClient, NpmRegistryUnavailableError } from "../dist/extensions/index.js";

const integrity = `sha512-${Buffer.alloc(64, 3).toString("base64")}`;
const resolution = { packageName: "safe-extension", version: "1.0.0", integrity, tarballUrl: "https://registry.npmjs.org/safe-extension/-/safe-extension-1.0.0.tgz" };
const safeLock = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/safe-extension": { version: "1.0.0", integrity, resolved: resolution.tarballUrl } } });
const worker = new URL("../dist/extensions/installerWorker.js", import.meta.url).pathname;

async function withRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "terminay-npm-client-"));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("npm materialization validates the generated lock before any package is installed", () => withRoot(async (root) => {
  const calls = [];
  const client = new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "test", runner: async (request) => {
    calls.push(request.op);
    await writeFile(join(request.root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/safe-extension": { version: "1.0.0", integrity, resolved: resolution.tarballUrl }, "node_modules/hostile": { version: "1.0.0", integrity, resolved: "git+https://evil.test/repo.git" } } }));
    return { ok: true };
  } });
  await assert.rejects(client.materialize(resolution, join(root, "stage")), /public npmjs/u);
  assert.deepEqual(calls, ["lock"]);
}));

test("a safe closure locks the exact version, then installs that lock unchanged", () => withRoot(async (root) => {
  const requests = []; const environments = [];
  const client = new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "test", runner: async (request, options) => {
    requests.push(request); environments.push(options.env);
    if (request.op === "lock") await writeFile(join(request.root, "package-lock.json"), safeLock);
    return { ok: true };
  } });
  await client.materialize(resolution, join(root, "stage"));
  assert.deepEqual(requests.map(({ op }) => op), ["lock", "install"]);
  assert.equal(requests[0].spec, "safe-extension@1.0.0"); assert.equal(requests[0].uploaded, false);
  assert.ok(environments.every((env) => env.ELECTRON_RUN_AS_NODE === "1" && env.TERMINAY_INSTALLER_WORKER === "1"));
}));

test("an install that rewrites the validated lock is rejected", () => withRoot(async (root) => {
  const client = new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "test", runner: async (request) => {
    await writeFile(join(request.root, "package-lock.json"), request.op === "lock" ? safeLock : `${safeLock}\n`);
    return { ok: true };
  } });
  await assert.rejects(client.materialize(resolution, join(root, "stage")), /changed the validated lockfile/u);
}));

test("registry network failures expose a typed actionable preview state", () => withRoot(async (root) => {
  const client = new NpmRegistryClient({ workRoot: root, installerVersion: "test", runner: async () => ({ ok: false, code: "ENOTFOUND" }) });
  await assert.rejects(client.resolve("safe-extension", "latest"), (error) => error instanceof NpmRegistryUnavailableError && error.code === "registry_unavailable" && error.retryable === true && /retry/u.test(error.action));
}));

test("the libraries receive one fixed public-registry, scriptless option set", () => {
  const options = installerLibraryOptions("/cache", false);
  assert.deepEqual(Object.keys(options).sort(), ["allowDirectory", "allowFile", "allowGit", "allowRemote", "audit", "binLinks", "cache", "fund", "ignoreScripts", "omit", "registry", "userAgent", "workspacesEnabled"]);
  assert.equal(options.registry, "https://registry.npmjs.org/"); assert.equal(options.ignoreScripts, true); assert.equal(options.binLinks, false); assert.deepEqual(options.omit, ["dev"]);
  assert.equal(options.allowGit, "none"); assert.equal(options.allowRemote, "none"); assert.equal(options.allowDirectory, "none"); assert.equal(options.allowFile, "none");
  assert.equal(installerLibraryOptions("/cache", true).allowFile, "root");
  assert.ok(Object.isFrozen(options));
});

test("the worker sees none of the server's npm configuration, proxies, or credentials", () => withRoot(async (root) => {
  const echo = join(root, "echo.mjs");
  await writeFile(echo, "process.stdout.write(JSON.stringify({ ok: true, manifest: { name: 'safe-extension', version: '1.0.0', dist: { integrity: 'sha512-x' }, terminay: { env: process.env } } }));\n");
  await writeFile(join(root, ".npmrc"), "registry=http://127.0.0.1:9/\n//127.0.0.1:9/:_authToken=secret\n");
  const saved = { ...process.env };
  Object.assign(process.env, { npm_config_registry: "http://127.0.0.1:9/", npm_config_userconfig: join(root, ".npmrc"), HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", NODE_OPTIONS: "--require=/nonexistent", NPM_TOKEN: "secret" });
  try {
    const client = new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "test", workerEntrypoint: echo });
    const { manifestMetadata } = await client.resolve("safe-extension", "1.0.0");
    const env = Object.fromEntries(Object.entries(manifestMetadata.env).filter(([key]) => !key.startsWith("__CF") && key !== "PWD" && key !== "SHLVL" && key !== "_"));
    assert.deepEqual(Object.keys(env).sort(), ["ELECTRON_RUN_AS_NODE", "HOME", "NODE_ENV", "TERMINAY_INSTALLER_WORKER", "TMPDIR"]);
    assert.ok(env.HOME.startsWith(join(root, "work")));
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
}));

test("a hung worker is killed at the deadline", () => withRoot(async (root) => {
  const hang = join(root, "hang.mjs"); await writeFile(hang, "setInterval(() => {}, 1000);\n");
  const client = new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "test", workerEntrypoint: hang, workerDeadlineMs: 300 });
  const started = Date.now();
  await assert.rejects(client.resolve("safe-extension", "latest"), /extension installer failed \(ETIMEDOUT_WORKER\)/u);
  assert.ok(Date.now() - started < 5_000);
}));

async function uploadedFixture(root, dependencies, extra = {}) {
  const source = join(root, "source"); await mkdir(source, { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "uploaded-fixture", version: "1.0.0", dependencies, ...extra.packageJson }));
  for (const [name, text] of Object.entries(extra.files ?? {})) await writeFile(join(source, name), text);
  const archivePath = join(root, "uploaded-fixture-1.0.0.tgz");
  const load = createRequire(import.meta.url);
  await load("pacote").tarball.file(source, archivePath, { Arborist: load("@npmcli/arborist"), ignoreScripts: true, cache: join(root, "pack-cache") });
  const digest = createHash("sha512").update(await readFile(archivePath)).digest("base64");
  return { packageName: "uploaded-fixture", version: "1.0.0", integrity: `sha512-${digest}`, source: "uploaded", archivePath };
}

for (const [kind, dependency, code] of [["git", "git+https://example.invalid/repo.git", "EALLOWGIT"], ["remote tarball", "https://example.invalid/x.tgz", "EALLOWREMOTE"], ["file", "file:../elsewhere.tgz", "EALLOWFILE"]]) {
  test(`the real worker refuses a ${kind} dependency below an uploaded archive without fetching it`, () => withRoot(async (root) => {
    const upload = await uploadedFixture(root, { nested: dependency });
    const client = new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "test", workerEntrypoint: worker });
    await assert.rejects(client.materialize(upload, join(root, "stage")), new RegExp(`\\(${code}\\)`, "u"));
  }));
}

test("the real worker installs a dependency-free uploaded archive with scripts and bin links disabled", () => withRoot(async (root) => {
  const upload = await uploadedFixture(root, {}, { packageJson: { bin: { fixture: "cli.js" }, scripts: { install: "node -e \"require('fs').writeFileSync('ran','')\"" } }, files: { "cli.js": "#!/usr/bin/env node\n" } });
  const client = new NpmRegistryClient({ workRoot: join(root, "work"), installerVersion: "test", workerEntrypoint: worker });
  await client.materialize(upload, join(root, "stage"));
  const installed = join(root, "stage", "node_modules", "uploaded-fixture");
  assert.equal(JSON.parse(await readFile(join(installed, "package.json"), "utf8")).version, "1.0.0");
  await assert.rejects(readFile(join(installed, "ran")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, "stage", "node_modules", ".bin", "fixture")), { code: "ENOENT" });
}));
