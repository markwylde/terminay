import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ExtensionHostManager,
  ExtensionHostComposedSshRuntime,
  ProjectEnvironmentRepository,
  PuzedSshCompositionBroker,
  PuzedSshCompositionService,
  RepositoryCanonicalProjectOpener,
  WorkspaceStore,
  createInitialWorkspace,
} from "../dist/index.js";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const puzedRepo = process.env.TERMINAY_PUZED_PLUGIN_REPO;
const sshRepo = process.env.TERMINAY_SSH_PLUGIN_REPO;
const enabled = process.env.TERMINAY_RUN_PACKED_COMPOSITION_E2E === "1";
const apiPackage = join(repository, "packages/extension-api");
const puzedId = "com.puzed.platform";
const puzedProvider = "com.puzed.platform/vm";
const sshId = "com.terminay.ssh";
const sshProvider = "com.terminay.ssh/connection";

test("packed Puzed child composes a private host key, SSH readiness, and one canonical project", { skip: !enabled, timeout: 120_000 }, async (t) => {
  assert.ok(puzedRepo && sshRepo, "set TERMINAY_PUZED_PLUGIN_REPO and TERMINAY_SSH_PLUGIN_REPO to official plugin checkouts");
  const root = await mkdtemp(join(tmpdir(), "terminay-packed-composition-"));
  const image = `terminay-composition-${process.pid}`;
  assert.equal(run("docker", ["build", "-t", image, join(sshRepo, "test/e2e")]).status, 0);
  const started = run("docker", ["run", "-d", "-P", image]); assert.equal(started.status, 0, started.stderr); const container = started.stdout.trim();
  t.after(() => { run("docker", ["rm", "-f", container]); run("docker", ["image", "rm", "-f", image]); });
  const sshPort = Number(run("docker", ["port", container, "22/tcp"]).stdout.trim().split(":").at(-1)); assert.ok(sshPort > 0);
  const puzed = await pack(puzedRepo, join(root, "puzed"), false);
  const ssh = await pack(sshRepo, join(root, "ssh"), true);
  const fake = await fakePuzedApi(sshPort); t.after(() => fake.close());

  const secrets = new Map([["puzed-api-key", new TextEncoder().encode("api-secret-sentinel")]]);
  const bindings = new Map([[`${puzedId}:platform-1:api-key`, "puzed-api-key"]]);
  const secretBroker = {
    async withSecret(principal, request, use) {
      const secretId = bindings.get(`${principal.extensionId}:${request.profileId}:${request.fieldId}`);
      assert.ok(secretId, "child may resolve only an explicitly host-bound secret");
      const value = new Uint8Array(secrets.get(secretId));
      try { return await use(value); } finally { value.fill(0); }
    },
  };
  const profileCalls = [];
  let composedSsh;
  const profiles = {
    async get(extensionId, providerId, profileId) {
      profileCalls.push({ extensionId, providerId, profileId });
      if (extensionId === puzedId && providerId === puzedProvider && profileId === "platform-1") return { profileId, providerId, revision: 1, values: { "base-url": fake.url }, secretFields: ["api-key"] };
      if (extensionId === sshId && providerId === sshProvider && profileId === "probe") return { profileId, providerId, revision: 1, values: { displayName: "Probe", hostname: "127.0.0.1", port: 1, username: "nobody", authMode: "password", passwordSecretRef: "password", defaultRoot: "~", hostVerification: "strict", connectMs: 100, handshakeMs: 100, keepaliveMs: 100 }, secretFields: ["password"] };
      if (extensionId === sshId && providerId === sshProvider) return composedSsh.getProfile(profileId, new AbortController().signal);
      throw new Error("profile access denied");
    },
  };

  let durableComposition;
  let durableEnvironments;
  let projectOpenCalls = 0;
  const workspace = new WorkspaceStore(createInitialWorkspace("server-e2e"));
  const environments = new ProjectEnvironmentRepository({ async load() { return durableEnvironments; }, async commit(value) { durableEnvironments = structuredClone(value); } }, "server-e2e");
  await environments.load();
  const projects = new RepositoryCanonicalProjectOpener(environments, workspace);
  const vault = {
    async put(input) { secrets.set(input.id, new Uint8Array(input.value)); return { id: input.id }; },
    async remove(id) { return secrets.delete(id); },
    bindSshSecret({ profileId, fieldId, secretId }) { bindings.set(`${sshId}:${profileId}:${fieldId}`, secretId); },
    unbindSshSecret({ profileId, fieldId }) { bindings.delete(`${sshId}:${profileId}:${fieldId}`); },
  };
  let broker;
  const brokerProxy = { request(request, signal) { return broker.request(request, signal); } };
  const manager = new ExtensionHostManager({ broker: brokerProxy, profiles, secrets: secretBroker, limits: { invocationTimeoutMs: 15_000 } });
  composedSsh = new ExtensionHostComposedSshRuntime(join(root, "ssh-bindings.v1.json"), manager);
  const service = new PuzedSshCompositionService({
    backend: { async load() { return structuredClone(durableComposition); }, async commit(value) { durableComposition = structuredClone(value); } },
    vault, ssh: composedSsh,
    projects: { async open(input, signal) { projectOpenCalls += 1; return projects.open(input, signal); } },
  });
  broker = new PuzedSshCompositionBroker(service);
  broker.registerManifest(puzed.manifest);
  t.after(() => manager.shutdown());
  await manager.start(descriptor(ssh, root));
  await manager.start(descriptor(puzed, root));
  assert.deepEqual(manager.providerDefinitions().map(({ providerId }) => providerId).sort(), [puzedProvider, sshProvider]);

  const imageOptions=await manager.invokeProvider({providerId:puzedProvider,callback:"resolveOptions",request:{sourceId:"com.puzed.platform/images",profileId:"platform-1",values:{}}});
  assert.deepEqual(imageOptions.options.map(option=>[option.value,option.label]),[["image-1","Debian"]]);
  const sizeOptions=await manager.invokeProvider({providerId:puzedProvider,callback:"resolveOptions",request:{sourceId:"com.puzed.platform/sizes",profileId:"platform-1",values:{}}});
  assert.deepEqual(sizeOptions.options.map(option=>option.value),["medium","custom"]);

  // The packed SSH child separately resolves a host-owned profile. A refused
  // loopback port is intentional: this proof substitutes only external SSH.
  const sshIssues = await manager.invokeProvider({ providerId: sshProvider, callback: "testProfile", request: { profileId: "probe", values: {} } });
  assert.ok(sshIssues.length > 0);
  assert.ok(profileCalls.some((call) => call.extensionId === sshId && call.profileId === "probe"));

  const request = { environmentId: "requested-env", profileId: "platform-1", displayName: "Dev VM", values: { name: "dev-vm", "image-id": "image-1", "size-id": "medium", "host-mode": "automatic", "network-mode": "default", "ssh-username": "terminay", "ssh-port": sshPort, "default-root": "/home/terminay/project" } };
  const context = { idempotencyKey: "create-vm-1" };
  const first = await manager.invokeProvider({ providerId: puzedProvider, callback: "createEnvironment", request, ...context });
  assert.equal(first.state, "pending");
  assert.equal(fake.creates.length, 1);
  const sent = JSON.stringify(fake.creates[0]);
  assert.match(sent, /ssh-ed25519/);
  assert.equal(sent.includes("PRIVATE KEY"), false);
  assert.equal(sent.includes("api-secret-sentinel"), false);
  assert.equal(JSON.stringify(first).includes("PRIVATE KEY"), false);
  const publicKeyFile = join(root, "terminay.pub"); await writeFile(publicKeyFile, fake.creates[0].ssh_public_key ?? fake.creates[0].ssh_keys?.[0] ?? "");
  assert.equal(run("docker", ["cp", publicKeyFile, `${container}:/tmp/terminay.pub`]).status, 0);
  assert.equal(run("docker", ["exec", container, "sh", "-c", "mkdir -p /home/terminay/.ssh && cat /tmp/terminay.pub > /home/terminay/.ssh/authorized_keys && chown -R terminay:terminay /home/terminay/.ssh && chmod 700 /home/terminay/.ssh && chmod 600 /home/terminay/.ssh/authorized_keys"]).status, 0);

  fake.ready = true;
  let awaitingTrust = first;
  for (let attempt = 0; attempt < 8 && !awaitingTrust.progress?.stages.some((stage) => stage.id === "awaiting-host-trust" && stage.state === "active"); attempt += 1) {
    awaitingTrust = await manager.invokeProvider({ providerId: puzedProvider, callback: "resumeOperation", request: { environmentId: request.environmentId, profileId: request.profileId, operationId: awaitingTrust.operationId, providerState: awaitingTrust.providerState }, idempotencyKey: `resume-before-trust-${attempt}` });
  }
  assert.equal(awaitingTrust.state, "pending");
  assert.ok(awaitingTrust.progress.stages.some((stage) => stage.id === "awaiting-host-trust" && stage.state === "active"), JSON.stringify(awaitingTrust));
  const trusted = await manager.invokeProvider({ providerId: puzedProvider, callback: "invokeAction", request: { environmentId: request.environmentId, profileId: request.profileId, providerState: awaitingTrust.providerState, actionId: "trust-host", values: {} }, expectedRevision: 2, idempotencyKey: "approve-trust" });
  let ready = trusted;
  for (let attempt = 0; attempt < 8 && ready.state !== "ready"; attempt += 1) ready = await manager.invokeProvider({ providerId: puzedProvider, callback: "resumeOperation", request: { environmentId: request.environmentId, profileId: request.profileId, operationId: ready.operationId ?? first.operationId, providerState: ready.providerState }, idempotencyKey: `resume-after-trust-${attempt}` });
  assert.equal(ready.state, "ready");
  assert.ok(projectOpenCalls >= 1);

  const [project] = Object.values(workspace.state.projects);
  assert.ok(project);
  assert.equal(project.projectEnvironmentId, "puzed:platform-1:machine-1");
  const environment = (await environments.load()).environments[project.projectEnvironmentId];
  assert.equal(environment.providerId, sshProvider);
  assert.equal(environment.providerState.sshBindingId.startsWith("puzed-ssh:"), true);
  assert.equal(JSON.stringify(durableComposition).includes("PRIVATE KEY"), false);

  // Restart the real Puzed child over the same extension data, then replay the
  // original create command. Neither the VM, key binding, nor project repeats.
  await manager.stop(puzedId);
  await manager.start(descriptor(puzed, root));
  const replay = await manager.invokeProvider({ providerId: puzedProvider, callback: "createEnvironment", request, ...context });
  assert.equal(replay.state, "ready");
  assert.equal(fake.creates.length, 1);
  assert.ok(projectOpenCalls >= 1);
  assert.equal(Object.keys(workspace.state.projects).length, 1);
  const persistedPuzed = await readFile(join(root, "data", puzedId, "puzed-state.json"), "utf8");
  assert.equal(persistedPuzed.includes("PRIVATE KEY"), false);
});

async function pack(repo, destination, install) {
  await mkdir(destination, { recursive: true });
  const packed = run("npm", ["pack", "--pack-destination", destination, "--json"], repo); assert.equal(packed.status, 0, packed.stderr);
  const result=JSON.parse(packed.stdout),entries=Array.isArray(result)?result:Object.values(result);assert.equal(entries.length,1,`npm pack did not produce exactly one archive: ${packed.stdout}`);const filename=entries[0].filename; assert.equal(run("tar", ["-xzf", join(destination, filename), "-C", destination]).status, 0);
  const packageRoot = join(destination, "package");
  if (install) { const result = run("npm", ["install", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps"], packageRoot); assert.equal(result.status, 0, result.stderr); }
  const scope = join(packageRoot, "node_modules", "@terminay"); await mkdir(scope, { recursive: true }); await symlink(apiPackage, join(scope, "extension-api"), "dir");
  return { packageRoot, manifest: (JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))).terminay };
}
function descriptor(pkg, root) { const id = pkg.manifest.id; return { extensionId: id, packageRoot: pkg.packageRoot, entrypoint: pkg.manifest.entrypoint, configDirectory: join(root, "config", id), dataDirectory: join(root, "data", id), cacheDirectory: join(root, "cache", id), permissions: pkg.manifest.permissions }; }
function run(command, args, cwd) { return spawnSync(command, args, { cwd, encoding: "utf8" }); }

async function fakePuzedApi(sshPort) {
  const state = { ready: false, creates: [] };
  const now = "2026-08-12T12:00:00Z"; const gib = 1024 ** 3;
  const machine = { id: "machine-1", name: "dev-vm", status: "running", tags: ["system:Terminay"], state_stale: false, resource_version: 7 };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost"); let body = ""; for await (const chunk of request) body += chunk;
    assert.equal(request.headers.authorization, "Bearer api-secret-sentinel");
    let value;
    if (url.pathname === "/api/v1/org/settings") value = { settings: { id: "settings", default_bridge_id: "bridge-1", default_image_id: "image-1", default_size_preset_id: "medium", default_size_presets: [{ id: "medium", label: "Medium", vcpus: 2, memory_bytes: 2 * gib, root_disk_bytes: 20 * gib }], resource_version: 1, created_at: now, updated_at: now } };
    else if (url.pathname === "/api/v1/images") value = { items: [{ id: "image-1", name: "Debian", arch: "x86_64", cloud_init_supported: true, status: "ready", min_disk_bytes: 8 * gib, os_family: "debian", default_console: "serial", featured: true, format: "qcow2", resource_version: 1, source_type: "url", created_at: now, updated_at: now }] };
    else if (url.pathname === "/api/v1/workers") value = { items: [{ id: "worker-1", name: "home", hostname: "home", address: "https://home", arch: "x86_64", status: "online", draining: false, fault_state: "ok", cpu_cores: 16, memory_total_bytes: 64 * gib, storage_free_bytes: 500 * gib, storage_total_bytes: 1000 * gib, agent_version: "1", labels: {}, resource_version: 1, last_heartbeat_at: now, created_at: now, updated_at: now }] };
    else if (url.pathname === "/api/v1/bridges") value = { items: [{ id: "bridge-1", name: "br0", worker_id: "worker-1", is_default: true, resource_version: 1, created_at: now, updated_at: now }] };
    else if (url.pathname === "/api/v1/machines" && request.method === "POST") { state.creates.push(JSON.parse(body)); value = { machine: { ...machine, status: "provisioning" }, job_id: "job-1" }; }
    else if (url.pathname === "/api/v1/jobs/job-1") value = { job: { id: "job-1", status: state.ready ? "succeeded" : "running" } };
    else if (url.pathname === "/api/v1/machines/machine-1") value = { machine };
    else if (url.pathname === "/api/v1/machines/machine-1/interfaces") value = { items: [{ id: "nic-1", observed_ip: "127.0.0.1", ssh_port: sshPort }] };
    else { response.writeHead(404); response.end(); return; }
    response.writeHead(request.method === "POST" ? 202 : 200, { "content-type": "application/json" }); response.end(JSON.stringify(value));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return Object.assign(state, { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) });
}
