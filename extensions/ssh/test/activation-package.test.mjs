import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import extension, { EXTENSION_ID, PROVIDER_ID } from "../dist/index.js";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["INIT_CWD", "npm_config_local_prefix", "npm_config_user_agent", "npm_config_workspace"].includes(key)));

test("activation registers the canonical bounded provider and methods", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-ssh-activate-")); const providers = [];
  await extension.activate({ extensionId: EXTENSION_ID, apiVersion: "1.0.0", paths: { configuration: join(root, "config"), data: join(root, "data"), cache: join(root, "cache") }, registerProjectEnvironmentProvider(value) { providers.push(value); } });
  assert.equal(providers[0].definition.providerId, PROVIDER_ID); assert.deepEqual(providers[0].definition.capabilities, ["terminal", "filesystem", "git", "agent-journal", "process-observation"]); assert.equal(providers[0].definition.profileForm.id, "ssh-profile");
  for (const callback of ["testProfile", "resolveOptions", "createEnvironment", "resumeOperation", "getStatus", "invokeAction"]) assert.equal(typeof providers[0].runtime[callback], "function");
  assert.deepEqual(await providers[0].runtime.resolveOptions({ sourceId: "unknown", values: {} }, call()), { options: [] });
  assert.equal((await providers[0].runtime.testProfile({ values: {} }, call()))[0].code, "invalid-input"); await extension.deactivate();
});

test("public SDK conformance accepts the package manifest", () => {
  const cli = join(dirname(require.resolve("@terminay/extension-api")), "conformance.js");
  const result = spawnSync(process.execPath, [cli, "package.json"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Valid Terminay extension: com\.terminay\.ssh/);
});

test("packed tarball contains precompiled ESM and activates without repository sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-ssh-pack-")); const repository = new URL("../../../", import.meta.url);
  const packed = spawnSync("npm", ["pack", "--workspace", "terminay-plugin-ssh", "--pack-destination", root, "--json"], { cwd: repository, encoding: "utf8", env: npmEnvironment }); assert.equal(packed.status, 0, packed.stderr);
  const filename = packedFilename(packed.stdout); const extracted = spawnSync("tar", ["-xzf", join(root, filename), "-C", root], { encoding: "utf8" }); assert.equal(extracted.status, 0, extracted.stderr);
  const packageJson = JSON.parse(await readFile(join(root, "package", "package.json"), "utf8")); assert.equal(packageJson.terminay.id, EXTENSION_ID); assert.equal(packageJson.scripts.install, undefined); assert.equal(packageJson.scripts.build, undefined);
  const files = await recursive(join(root, "package")); assert.equal(files.some((file) => file.endsWith(".node") || file.endsWith("binding.gyp")), false); assert.equal(files.some((file) => file.includes("/test/") || file.includes("/scripts/")), false);
  const api = spawnSync("npm", ["pack", "--workspace", "@terminay/extension-api", "--pack-destination", root, "--json"], { cwd: repository, encoding: "utf8", env: npmEnvironment }); assert.equal(api.status, 0, api.stderr);
  const apiFilename = packedFilename(api.stdout);
  const installed = spawnSync("npm", ["install", "--ignore-scripts", "--omit=dev", join(root, apiFilename)], { cwd: join(root, "package"), encoding: "utf8", env: npmEnvironment }); assert.equal(installed.status, 0, installed.stderr);
  const imported = await import(`${pathToFileURL(join(root, "package", "dist", "index.js")).href}?packed=1`); assert.equal(typeof imported.activate, "function");
});

test("resolved dependency closure has no install hooks or native artifacts", async () => {
  const lock = JSON.parse(await readFile(new URL("../../../package-lock.json", import.meta.url), "utf8"));
  const names = new Set(["@electerm/ssh2", "@noble/ciphers", "@noble/curves", "@noble/hashes", "asn1", "bcrypt-pbkdf", "iconv-lite", "safer-buffer", "sm-crypto-v2", "sm-polyfill", "tweetnacl"]);
  for (const [path, record] of Object.entries(lock.packages)) {
    const name = path.replace(/^node_modules\//u, "");
    if (!names.has(name)) continue;
    assert.notEqual(record.hasInstallScript, true, path);
    assert.equal(path.endsWith(".node"), false, path);
  }
});

async function recursive(directory) { const output = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) output.push(...await recursive(path)); else output.push(path); } return output; }
function call() { return { deadlineAt: new Date(Date.now() + 10000).toISOString(), signal: new AbortController().signal, dependencies: { call: async () => ({}) }, profiles: { get: async () => ({}) }, secrets: { withValue: async (_request, use) => use(new Uint8Array()) }, sshAgent: { listIdentities: async () => [], sign: async () => { throw new Error("unavailable"); } } }; }
function packedFilename(output) { const parsed = JSON.parse(output); const item = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]; assert.equal(typeof item?.filename, "string"); return item.filename; }
