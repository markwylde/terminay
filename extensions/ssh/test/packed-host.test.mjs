import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { EXTENSION_ID, PROVIDER_ID } from "../dist/index.js";
import { readFile } from "node:fs/promises";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["INIT_CWD", "npm_config_local_prefix", "npm_config_user_agent", "npm_config_workspace"].includes(key)));
const projectEnvironmentProviders = [{ id: PROVIDER_ID, displayName: "SSH server", capabilities: ["terminal", "filesystem", "git", "agent-journal", "process-observation"], dependencyOperations: ["generate", "bind", "update", "verify", "approve-trust", "service", "remove"].map((name) => ({ name: `managed-binding.${name}` })) }];

test("packed package activates and all public provider callbacks cross the real host IPC", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-ssh-host-")); const repository = new URL("../../../", import.meta.url); const packed = spawnSync("npm", ["pack", "--workspace", "terminay-plugin-ssh", "--pack-destination", root, "--json"], { cwd: repository, encoding: "utf8", env: npmEnvironment }); assert.equal(packed.status, 0, packed.stderr);
  const filename = packedFilename(packed.stdout); assert.equal(spawnSync("tar", ["-xzf", join(root, filename), "-C", root], { encoding: "utf8" }).status, 0);
  const api = spawnSync("npm", ["pack", "--workspace", "@terminay/extension-api", "--pack-destination", root, "--json"], { cwd: repository, encoding: "utf8", env: npmEnvironment }); assert.equal(api.status, 0, api.stderr);
  const packageRoot = join(root, "package"); const installed = spawnSync("npm", ["install", "--ignore-scripts", "--omit=dev", "--audit=false", "--fund=false", join(root, packedFilename(api.stdout))], { cwd: packageRoot, encoding: "utf8", env: npmEnvironment }); assert.equal(installed.status, 0, installed.stderr);
  const [{ ExtensionHostManager }] = await Promise.all([import(require.resolve("@terminay/server-core"))]);
  const configDirectory = join(root, "config"), dataDirectory = join(root, "data"), cacheDirectory = join(root, "cache"); await Promise.all([configDirectory, dataDirectory, cacheDirectory].map((path) => mkdir(path)));
  const brokerCalls = []; const manager = new ExtensionHostManager({ broker: { async request(request) { brokerCalls.push(request); throw new Error("fixture broker unavailable"); } } });
  await manager.start({ extensionId: EXTENSION_ID, packageRoot, entrypoint: "dist/index.js", configDirectory, dataDirectory, cacheDirectory, permissions: ["secrets:resolve", "network"], projectEnvironmentProviders, extensionDependencies: [] });
  assert.equal(manager.providerDefinitions()[0].providerId, PROVIDER_ID);
  const invoke = (callback, request, extra = {}) => manager.invokeProvider({ providerId: PROVIDER_ID, callback, request, ...extra });
  assert.deepEqual(await invoke("resolveOptions", { sourceId: "unknown", values: {} }), { options: [] });
  const issues = await invoke("testProfile", { values: {} }); assert.equal(issues[0].code, "invalid-input");
  await assert.rejects(invoke("createEnvironment", { environmentId: "env-1", displayName: "Broken", values: {} }, { idempotencyKey: "idempotent-1" }), /SSH profile values|invalid/i);
  for (const [callback, request] of [["resumeOperation", { environmentId: "env-1", operationId: "op", providerState: {} }], ["getStatus", { environmentId: "env-1", providerState: {} }], ["invokeAction", { environmentId: "env-1", providerState: {}, actionId: "retry" }]]) await assert.rejects(invoke(callback, request), /provider state is invalid/i);
  assert.equal(manager.statuses()[0].state, "running"); assert.equal(brokerCalls.length, 0); await manager.shutdown();
});

test("published manifest explicitly grants the host-scoped SSH agent permission", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.terminay.permissions.includes("ssh-agent:use"), true);
  assert.equal(pkg.terminay.permissions.filter((permission) => permission === "ssh-agent:use").length, 1);
});
function packedFilename(output) { const parsed = JSON.parse(output); const item = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]; assert.equal(typeof item?.filename, "string"); return item.filename; }
