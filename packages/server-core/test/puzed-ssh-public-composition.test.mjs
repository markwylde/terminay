import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHostManager, ServerVaultService } from "../dist/index.js";

const repository = new URL("../../../", import.meta.url);
const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["INIT_CWD", "npm_config_local_prefix", "npm_config_user_agent", "npm_config_workspace"].includes(key)));

test("packed Puzed calls packed SSH only through the public dependency and target vault", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-public-puzed-ssh-"));
  const image = "terminay-public-puzed-ssh:task63";
  const built = spawnSync("docker", ["build", "-t", image, new URL("../../../extensions/ssh/test/e2e/", import.meta.url).pathname], { encoding: "utf8" }); assert.equal(built.status, 0, built.stderr);
  const started = spawnSync("docker", ["run", "-d", "-P", image], { encoding: "utf8" }); assert.equal(started.status, 0, started.stderr); const container = started.stdout.trim();
  const published = spawnSync("docker", ["port", container, "22/tcp"], { encoding: "utf8" }); assert.equal(published.status, 0, published.stderr); const sshPort = Number(published.stdout.trim().split(":").at(-1)); assert.ok(sshPort > 0);
  const api = pack("@terminay/extension-api", root);
  const ssh = await unpack("terminay-plugin-ssh", "ssh", root, api);
  const puzed = await unpack("terminay-plugin-puzed", "puzed", root, api);
  const secrets = new Map(); const externalBrokerCalls = [];
  const vault = new ServerVaultService({
    backend: "custom", status: () => "unlocked", unlock: async () => {}, lock() {},
    list: () => [...secrets.keys()].map((id) => ({ id, configured: true })),
    async put({ id, value }) { secrets.set(id, new Uint8Array(value)); return { id, configured: true }; },
    async replace({ id, value }) { secrets.set(id, new Uint8Array(value)); return { id, configured: true }; },
    async test(id) { if (!secrets.has(id)) throw new Error("missing"); }, async remove(id) { return secrets.delete(id); }, async rotate() {},
    async withSecret(id, use) { const source = secrets.get(id); if (!source) throw new Error("missing"); const copy = new Uint8Array(source); try { return await use(copy); } finally { copy.fill(0); } },
  });
  const manager = new ExtensionHostManager({ vault, broker: { async request(request) { externalBrokerCalls.push(request); throw new Error("external broker unavailable"); } } });
  const sshContribution = { id: "com.terminay.ssh/connection", displayName: "SSH server", capabilities: ["terminal", "filesystem", "agent-journal"], dependencyOperations: ["generate", "bind", "update", "verify", "approve-trust", "service", "remove"].map((name) => ({ name: `managed-binding.${name}` })) };
  const sshDescriptor = descriptor(root, ssh, "com.terminay.ssh", [sshContribution], []);
  const puzedDescriptor = descriptor(root, puzed, "com.puzed.platform", [{ id: "com.puzed.platform/vm", displayName: "Puzed VM", capabilities: ["terminal", "filesystem"] }], [{ extensionId: "com.terminay.ssh", apiRange: "^1.1.0" }]);
  try {
    await manager.start(sshDescriptor);
    await manager.start(puzedDescriptor);
    const created = await manager.invokeProvider({
      providerId: "com.puzed.platform/vm", callback: "createEnvironment", idempotencyKey: "create-packed-vm",
      request: { environmentId: "env-1", profileId: "profile-1", displayName: "Packed VM", values: { baseUrl: "https://platform.test", machineId: "machine-1", operationId: "operation-1", host: "127.0.0.1", port: sshPort, username: "terminay", root: "/home/terminay/project" } },
    });
    assert.equal(created.state, "pending"); const challengeId = created.providerState.trustChallenge.challengeId; assert.equal(typeof challengeId, "string");
    const approved = await manager.invokeProvider({ providerId: "com.puzed.platform/vm", callback: "invokeAction", idempotencyKey: "approve-packed-host", expectedRevision: created.providerState.sshRevision, request: { environmentId: "env-1", profileId: "profile-1", providerState: created.providerState, actionId: "trust-host", values: { challengeId } } });
    assert.equal(approved.state, "complete");
    const resumed = await manager.invokeProvider({ providerId: "com.puzed.platform/vm", callback: "resumeOperation", expectedRevision: approved.providerState.sshRevision, request: { environmentId: "env-1", profileId: "profile-1", operationId: created.operationId, providerState: approved.providerState } });
    assert.equal(resumed.state, "ready"); assert.equal(resumed.status.defaultRoot, "/home/terminay/project");
    await manager.invokeProvider({ providerId: "com.puzed.platform/vm", callback: "invokeService", expectedRevision: resumed.providerState.sshRevision, request: { environmentId: "env-1", profileId: "profile-1", providerState: resumed.providerState, capability: "filesystem", operation: "write", projectId: "project-1", environmentRevision: resumed.providerState.sshRevision, input: { path: "public-composition.txt", data: "packed-puzed-ssh" } } });
    const read = await manager.invokeProvider({ providerId: "com.puzed.platform/vm", callback: "invokeService", expectedRevision: resumed.providerState.sshRevision, request: { environmentId: "env-1", profileId: "profile-1", providerState: resumed.providerState, capability: "filesystem", operation: "read", projectId: "project-1", environmentRevision: resumed.providerState.sshRevision, input: { path: "public-composition.txt" } } });
    assert.equal(Buffer.from(read.data, "base64").toString(), "packed-puzed-ssh");
    await manager.stop("com.puzed.platform"); await manager.start(puzedDescriptor);
    assert.equal((await manager.invokeProvider({ providerId: "com.puzed.platform/vm", callback: "resumeOperation", expectedRevision: resumed.providerState.sshRevision, request: { environmentId: "env-1", profileId: "profile-1", operationId: created.operationId, providerState: resumed.providerState } })).state, "ready");
    await manager.stop("com.terminay.ssh");
    await assert.rejects(manager.invokeProvider({ providerId: "com.puzed.platform/vm", callback: "resumeOperation", expectedRevision: resumed.providerState.sshRevision, request: { environmentId: "env-1", profileId: "profile-1", operationId: created.operationId, providerState: resumed.providerState } }), /target is unavailable/);
    await manager.start(sshDescriptor);
    assert.equal((await manager.invokeProvider({ providerId: "com.puzed.platform/vm", callback: "resumeOperation", expectedRevision: resumed.providerState.sshRevision, request: { environmentId: "env-1", profileId: "profile-1", operationId: created.operationId, providerState: resumed.providerState } })).state, "ready");
    assert.equal(secrets.size, 1, "SSH target stored one private key in the host vault");
    assert.equal(externalBrokerCalls.length, 0, "generic manager routed the declared dependency internally");
    assert.equal(JSON.stringify(manager.statuses()).includes("PRIVATE KEY"), false);
  } finally { await manager.shutdown(); spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" }); }
});

function pack(workspace, root) { const built = spawnSync("npm", ["run", workspace === "terminay-plugin-ssh" ? "compile" : "build", "--workspace", workspace], { cwd: repository, encoding: "utf8", env: npmEnvironment }); assert.equal(built.status, 0, built.stderr); const packed = spawnSync("npm", ["pack", "--workspace", workspace, "--pack-destination", root, "--json"], { cwd: repository, encoding: "utf8", env: npmEnvironment }); assert.equal(packed.status, 0, packed.stderr); const result = JSON.parse(packed.stdout); return join(root, (Array.isArray(result) ? result[0] : Object.values(result)[0]).filename); }
async function unpack(workspace, name, root, api) { const archive = pack(workspace, root); const packageRoot = join(root, name); await mkdir(packageRoot); const extracted = spawnSync("tar", ["-xzf", archive, "-C", packageRoot, "--strip-components=1"], { encoding: "utf8" }); assert.equal(extracted.status, 0, extracted.stderr); if (workspace === "terminay-plugin-ssh") { const dependencies = spawnSync("npm", ["install", "--workspaces=false", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", api], { cwd: packageRoot, encoding: "utf8", env: npmEnvironment }); assert.equal(dependencies.status, 0, dependencies.stderr); } const apiRoot = join(packageRoot, "node_modules", "@terminay", "extension-api"); await mkdir(apiRoot, { recursive: true }); const installed = spawnSync("tar", ["-xzf", api, "-C", apiRoot, "--strip-components=1"], { encoding: "utf8" }); assert.equal(installed.status, 0, installed.stderr); return packageRoot; }
function descriptor(root, packageRoot, extensionId, projectEnvironmentProviders, extensionDependencies) { const name = extensionId.split(".").at(-1); return { extensionId, packageRoot, entrypoint: "dist/index.js", configDirectory: join(root, `${name}-config`), dataDirectory: join(root, `${name}-data`), cacheDirectory: join(root, `${name}-cache`), permissions: extensionId === "com.puzed.platform" ? ["provider:depend", "network", "secrets:resolve"] : ["network", "secrets:resolve"], projectEnvironmentProviders, extensionDependencies }; }
