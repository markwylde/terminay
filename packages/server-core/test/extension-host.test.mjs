import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExtensionHost,
  ExtensionHostManager,
  AgentStatusService,
  ExtensionAgentRuntimeRegistry,
  ServerVaultService,
  TerminalActivityService,
  assertExtensionCompatible,
  extensionChildEnvironment,
  extensionLaunchDescriptor,
  validateExtensionLaunchDescriptor,
} from "../dist/index.js";

function memoryVault() {
  const values = new Map();
  return new ServerVaultService({
    backend: "custom", status: () => "unlocked", unlock: async () => {}, lock: () => {},
    list: () => [...values.keys()].map((id) => ({ id, configured: true })),
    async put({ id, value }) { if (values.has(id)) throw new Error("exists"); values.set(id, new Uint8Array(value)); return { id, configured: true }; },
    async replace({ id, value }) { if (!values.has(id)) throw new Error("missing"); values.set(id, new Uint8Array(value)); return { id, configured: true }; },
    async test(id) { if (!values.has(id)) throw new Error("missing"); },
    async remove(id) { return values.delete(id); }, async rotate() {},
    async withSecret(id, use) { const value = values.get(id); if (!value) throw new Error("missing"); const copy = new Uint8Array(value); try { return await use(copy); } finally { copy.fill(0); } },
  });
}

async function fixture(extensionId, source) {
  const root = await mkdtemp(join(tmpdir(), "terminay-extension-host-"));
  const entrypoint = join(root, "extension.js");
  await writeFile(entrypoint, source, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId,
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions: ["secrets:resolve"],
  };
}

test("the extension child inherits host PATH and HOME without installer-style NODE_OPTIONS", () => {
  const env = extensionChildEnvironment({
    PATH: "/opt/custom/bin",
    HOME: "/tmp/terminay-home",
    NODE_OPTIONS: "--require ./evil.js",
    DYLD_INSERT_LIBRARIES: "/tmp/inject.dylib",
  });
  assert.match(env.PATH, /^\/opt\/custom\/bin:/u);
  assert.match(env.PATH, /\/usr\/sbin/u);
  assert.equal(env.HOME, "/tmp/terminay-home");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.DYLD_INSERT_LIBRARIES, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.TERMINAY_EXTENSION_HOST, "1");
});

test("one extension child activates, invokes methods, and uses an identity-scoped broker", async () => {
  const descriptor = await fixture("example.test", `
    export async function activate(context) {
      context.registerProjectEnvironmentProvider({ providerId: "example.test/main", displayName: "Example", capabilities: ["terminal"] });
      return { methods: {
        echo(input) { return { input, extensionId: context.extensionId }; },
        runtime() { return { electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE, nodeEnv: process.env.NODE_ENV, apiVersion: context.apiVersion, path: process.env.PATH, home: process.env.HOME }; },
        async log(input) { return context.broker.request("log", input); }
      }};
    }
  `);
  const requests = [];
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request(request) { requests.push(request); return "resolved-metadata"; } } });
  await host.start(descriptor);
  assert.equal(host.status().state, "running");
  assert.deepEqual(host.status().providers.map((provider) => provider.providerId), ["example.test/main"]);
  assert.deepEqual(await host.invoke({ method: "echo", input: "hello" }), { input: "hello", extensionId: "example.test" });
  const runtime = await host.invoke({ method: "runtime" });
  assert.equal(runtime.electronRunAsNode, "1");
  assert.equal(runtime.nodeEnv, "production");
  assert.equal(runtime.apiVersion, "1.2.0");
  assert.equal(typeof runtime.path, "string");
  assert.match(runtime.path, /\/usr\/sbin|\/usr\/bin|\/bin/u);
  if (process.env.HOME) assert.equal(runtime.home, process.env.HOME);
  assert.equal(await host.invoke({ method: "log", input: { message: "safe" } }), "resolved-metadata");
  assert.equal(requests[0].extensionId, "example.test");
  assert.equal(requests[0].operation, "log");
  await host.stop();
  assert.equal(host.status().state, "stopped");
});

test("the child supplies host-owned extension subscriptions", async () => {
  const descriptor = await fixture("example.subscriptions", `
    export function activate(context) {
      let disposed = false;
      const registration = { dispose() { disposed = true; } };
      if (context.subscriptions.add(registration) !== registration) throw new Error("subscription identity changed");
      return { methods: { disposed() { return disposed; } } };
    }
  `);
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} } });
  await host.start(descriptor);
  assert.equal(await host.invoke({ method: "disposed" }), false);
  await host.stop();
  assert.equal(host.status().state, "stopped");
});

test("cancellation and deadlines are bounded and do not block the server", async () => {
  const descriptor = await fixture("example.slow", `
    export function activate() {
      return { methods: { wait(_input, { signal }) { return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled in child")), { once: true });
      }); } } };
    }
  `);
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} }, limits: { invocationTimeoutMs: 20 } });
  await host.start(descriptor);
  await assert.rejects(host.invoke({ method: "wait" }), /timed out/);
  const controller = new AbortController();
  const pending = host.invoke({ method: "wait", signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(host.status().state, "running");
  await host.stop();
});

test("a crashing extension is isolated from another running provider", async () => {
  const healthy = await fixture("example.healthy", `export function activate() { return { methods: { ping() { return "pong"; } } }; }`);
  const crashing = await fixture("example.crashing", `export function activate() { return { methods: { crash() { process.exit(23); } } }; }`);
  const manager = new ExtensionHostManager({ broker: { async request() {} }, limits: { initialBackoffMs: 1 } });
  await manager.start(healthy);
  await manager.start(crashing);
  await assert.rejects(manager.invoke("example.crashing", { method: "crash" }), /exited/);
  assert.equal(await manager.invoke("example.healthy", { method: "ping" }), "pong");
  assert.equal(manager.statuses().find((status) => status.extensionId === "example.crashing").state, "failed");
  assert.equal(manager.statuses().find((status) => status.extensionId === "example.healthy").state, "running");
  await manager.shutdown();
});

test("manager publishes a complete contribution set only after activation", async () => {
  const descriptor = await fixture("example.atomic", `export async function activate(context) { await new Promise((resolve) => setTimeout(resolve, 40)); context.registerProjectEnvironmentProvider({ providerId: "example.atomic/main", displayName: "Atomic", capabilities: ["terminal"] }); }`);
  const manager = new ExtensionHostManager({ broker: { async request() {} }, agents: { async observe() { return { name: "codex" }; }, async publish(request) { return { acceptedEventCount: request.events.length }; } } });
  const start = manager.start(descriptor);
  assert.deepEqual(manager.providerDefinitions(), []);
  await start;
  assert.deepEqual(manager.providerDefinitions().map(({ providerId }) => providerId), ["example.atomic/main"]);
  await manager.shutdown();
});

test("only activated manifest-matching environment contributions are published", async () => {
  const descriptor = await fixture("example.declared", `export function activate(context) { context.registerProjectEnvironmentProvider({ providerId: "example.declared/direct", displayName: "Direct", capabilities: ["terminal", "filesystem"] }); }`);
  descriptor.projectEnvironmentProviders = [{ id: "example.declared/direct", displayName: "Direct", capabilities: ["terminal", "filesystem"], profileSave: { createEnvironment: true } }];
  const manager = new ExtensionHostManager({ broker: { async request() {} } });
  await manager.start(descriptor);
  assert.deepEqual(manager.activatedProjectEnvironmentContributions(), descriptor.projectEnvironmentProviders);
  await manager.stop(descriptor.extensionId);
  assert.deepEqual(manager.activatedProjectEnvironmentContributions(), []);

  const mismatch = await fixture("example.mismatch", `export function activate(context) { context.registerProjectEnvironmentProvider({ providerId: "example.mismatch/direct", displayName: "Unexpected", capabilities: ["terminal"] }); }`);
  mismatch.projectEnvironmentProviders = [{ id: "example.mismatch/direct", displayName: "Direct", capabilities: ["terminal"] }];
  await assert.rejects(manager.start(mismatch), /does not match its manifest contribution/);
  await manager.shutdown();
});

test("an agent provider may read terminal environment variables through observation", async (t) => {
  const descriptor = await fixture("example.agent-environment", `
    export function activate(context) {
      context.agents.registerProvider("example.agent-environment/cli", {
        mappingVersion: "v1", matchesForeground() { return true; },
        async observe(terminal) {
          const allowed = await terminal.observation.processes.environment(["CODEX_HOME"], { signal: new AbortController().signal });
          if (allowed.CODEX_HOME !== "/fixture/codex") throw new Error("environment value was unavailable");
          return { state: "not-bound" };
        },
      });
    }
  `);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{
    id: "example.agent-environment/cli",
    displayName: "Fixture agent",
    processMatchers: [{ executableName: "fixture-agent" }],
    requiredEnvironmentCapabilities: ["process-observation"],
    requiredEnvironmentVariables: ["CODEX_HOME"],
  }];
  const observedNames = [];
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    agents: {
      async observe(request) {
        observedNames.push(request.payload.names);
        return { CODEX_HOME: "/fixture/codex" };
      },
      async publish(request) { return { acceptedEventCount: request.events.length }; },
    },
  });
  t.after(async () => { await host.stop().catch(() => undefined); });
  await host.start(descriptor);
  await host.admitAgentTerminal({
    context: {
      contextId: "fixture-context", serverId: "fixture-server", projectId: "fixture-project",
      projectEnvironmentId: "terminay.this-server", terminalSessionId: "fixture-terminal",
      terminalIncarnationId: "1", providerId: "example.agent-environment/cli",
    },
    observationCapabilities: ["process-observation"],
  });
  assert.deepEqual(observedNames, [["CODEX_HOME"]]);
});

test("This-server terminals with a shell pid observe inside the extension child", async (t) => {
  const descriptor = await fixture("example.agent-local-observe", `
    export function activate(context) {
      context.agents.registerProvider("example.agent-local-observe/cli", {
        mappingVersion: "v1", matchesForeground() { return true; },
        async observe(terminal) {
          const descendants = await terminal.observation.processes.descendants();
          if (!Array.isArray(descendants)) throw new Error("local descendants were unavailable");
          return { state: "not-bound" };
        },
      });
    }
  `);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{
    id: "example.agent-local-observe/cli",
    displayName: "Local observe fixture",
    processMatchers: [{ executableName: "fixture-agent" }],
    requiredEnvironmentCapabilities: ["process-observation"],
  }];
  let hostObservations = 0;
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    agents: {
      async observe() { hostObservations += 1; return []; },
      async publish(request) { return { acceptedEventCount: request.events.length }; },
    },
  });
  t.after(async () => { await host.stop().catch(() => undefined); });
  await host.start(descriptor);
  await host.admitAgentTerminal({
    context: {
      contextId: "local-context", serverId: "server-1", projectId: "project-1",
      projectEnvironmentId: "terminay.this-server", terminalSessionId: "terminal-1",
      terminalIncarnationId: "1", providerId: "example.agent-local-observe/cli",
      shellPid: process.pid,
    },
    observationCapabilities: ["process-observation"],
  });
  assert.equal(hostObservations, 0);
});

test("seeded SSH and Puzed hosts reconcile four late agents and re-admit an existing Codex terminal", async (t) => {
  const manager = new ExtensionHostManager({ broker: { async request() {} }, agents: { async observe() { return { name: "codex" }; }, async publish(request) { return { acceptedEventCount: request.events.length }; } } });
  t.after(async () => { await manager.shutdown().catch(() => undefined); });
  const ssh = await fixture("com.terminay.ssh", `export function activate(context) { context.registerProjectEnvironmentProvider({ providerId: "com.terminay.ssh/connection", displayName: "SSH", capabilities: ["terminal"] }); }`);
  const puzed = await fixture("com.terminay.puzed", `export function activate(context) { context.registerProjectEnvironmentProvider({ providerId: "com.terminay.puzed/connection", displayName: "Puzed", capabilities: ["terminal"] }); }`);
  await manager.start(ssh); await manager.start(puzed);

  const identity = { serverId: "server-late", projectId: "project-late", sessionId: "terminal-late" };
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  t.after(async () => { await agents.stop().catch(() => undefined); });
  const failures = [];
  const runtime = new ExtensionAgentRuntimeRegistry({ agents, hosts: manager, reobserveDebounceMs: 0, onAdmissionFailure: (failure) => failures.push(failure) });
  manager.onContributionsChanged(() => { runtime.reobserveExistingTerminals(); });
  runtime.register(identity); runtime.terminalStarted(identity, 4242);
  assert.equal(runtime.foregroundProcessChanged(identity, "codex"), false, "SSH/Puzed do not claim coding-agent terminals");

  const lateAgents = [
    ["com.terminay.agent.codex", "codex", "Codex"],
    ["com.terminay.agent.claude-code", "claude", "Claude Code"],
    ["com.terminay.agent.cursor", "agent", "Cursor Agent"],
    ["com.terminay.agent.omp", "omp", "omp"],
  ];
  for (const [extensionId, executable, displayName] of lateAgents) {
    const descriptor = await fixture(extensionId, `export function activate(context) { context.agents.registerProvider("${extensionId}/cli", { mappingVersion: "late-v1", matchesForeground() { return true; }, async observe(terminal) { await terminal.observation.processes.descendants(); const binding = await terminal.bindSession({ providerSessionId: "late-session", mappingVersion: "late-v1", fingerprint: { kind: "fixture" } }); return { state: "bound", binding, source: { async *[Symbol.asyncIterator]() { yield { bytes: new TextEncoder().encode('{"type":"started"}\\n') }; } }, mapRecord(record, session) { if (record.type === "started") return session.publish.sessionStarted({ title: "Late Codex" }); } }; } }); }`);
    descriptor.permissions = ["agent-observation"];
    descriptor.agentProviders = [{ id: `${extensionId}/cli`, displayName, processMatchers: [{ executableName: executable }], requiredEnvironmentCapabilities: ["process-observation"] }];
    await manager.start(descriptor);
  }
  assert.deepEqual(manager.agentProviderContributions().map((provider) => provider.id), lateAgents.map(([extensionId]) => `${extensionId}/cli`).sort());
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(failures, []);
  assert.equal(agents.claimExtensionProvider(identity, "com.terminay.agent.codex/cli"), false, "the late Codex provider owns the already-running terminal");
  runtime.terminalExited(identity);
});

test("launch validation rejects escaping entrypoints before import", async () => {
  const descriptor = await fixture("example.escape", "export function activate() {}");
  await assert.rejects(validateExtensionLaunchDescriptor({ ...descriptor, entrypoint: "../outside.js" }), /entrypoint/);
});

test("public closed manifests are validated before constructing launch authority", async () => {
  const descriptor = await fixture("example.manifest", "export function activate() { return { methods: {} }; }");
  const manifest = {
    manifestVersion: 1,
    id: descriptor.extensionId,
    displayName: "Manifest fixture",
    api: "^1.0.0",
    engines: { terminay: ">=1", node: ">=22" },
    entrypoint: descriptor.entrypoint,
    permissions: descriptor.permissions,
    contributes: { projectEnvironments: [{ id: "example.manifest/provider", displayName: "Fixture", capabilities: ["terminal"] }] },
  };
  const launch = await extensionLaunchDescriptor({ ...descriptor, manifest });
  assert.equal(launch.descriptor.extensionId, descriptor.extensionId);
  await assert.rejects(extensionLaunchDescriptor({ ...descriptor, manifest: { ...manifest, unexpected: true } }), /Invalid Terminay extension manifest/);
});

test("validated agent manifest contributions are threaded into the launch descriptor", async () => {
  const input = await fixture("example.manifest-agent", "export function activate() {}");
  const manifest = {
    manifestVersion: 1, id: input.extensionId, displayName: "Manifest agent", api: "^1.1.0",
    engines: { terminay: ">=1", node: ">=22" }, entrypoint: input.entrypoint,
    permissions: ["agent-observation"],
    contributes: { agentProviders: [{ id: "example.manifest-agent/cli", displayName: "Fixture CLI", requiredEnvironmentCapabilities: ["process-observation"] }] },
  };
  const launch = await extensionLaunchDescriptor({ ...input, manifest });
  assert.deepEqual(launch.descriptor.agentProviders, manifest.contributes.agentProviders);
});

test("repeated activation failures quarantine only that extension", async () => {
  const descriptor = await fixture("example.quarantine", `export function activate() { throw new Error("fixture failure"); }`);
  let now = 1_000;
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    now: () => now,
    limits: { maxCrashesInWindow: 2, initialBackoffMs: 5, crashWindowMs: 1_000 },
  });
  await assert.rejects(host.start(descriptor), /fixture failure/);
  assert.equal(host.status().state, "failed");
  now += 10;
  await assert.rejects(host.start(descriptor), /fixture failure/);
  assert.equal(host.status().state, "quarantined");
  await assert.rejects(host.start(descriptor), /quarantined/);
  host.clearQuarantine();
  assert.equal(host.status().state, "stopped");
});

test("compatibility axes and extension dependencies fail before entrypoint import", () => {
  const base = {
    manifestVersion: 1, id: "example.compat", displayName: "Compatibility", api: "^1.0.0",
    engines: { terminay: ">=1.0.0", node: ">=22.0.0" }, entrypoint: "extension.js", permissions: [],
    contributes: { projectEnvironments: [{ id: "example.compat/main", displayName: "Main", capabilities: ["terminal"] }] },
  };
  assert.doesNotThrow(() => assertExtensionCompatible(base, { terminayVersion: "1.4.0", nodeVersion: "24.0.0", platform: "linux" }));
  assert.throws(() => assertExtensionCompatible({ ...base, api: "^2.0.0" }, { terminayVersion: "1.4.0" }), /API/);
  assert.throws(() => assertExtensionCompatible({ ...base, engines: { ...base.engines, terminay: ">=2.0.0" } }, { terminayVersion: "1.4.0" }), /Terminay/);
  assert.throws(() => assertExtensionCompatible({ ...base, engines: { ...base.engines, node: ">=99.0.0" } }, { terminayVersion: "1.4.0" }), /Node/);
  assert.throws(() => assertExtensionCompatible({ ...base, platforms: ["darwin"] }, { terminayVersion: "1.4.0", platform: "linux" }), /platform/);
  const dependent = { ...base, extensionDependencies: [{ extensionId: "example.required", apiRange: "^1.0.0" }] };
  assert.throws(() => assertExtensionCompatible(dependent, { terminayVersion: "1.4.0" }), /unavailable/);
  assert.throws(() => assertExtensionCompatible(dependent, { terminayVersion: "1.4.0", installedExtensions: new Map([["example.required", { apiVersion: "2.0.0" }]]) }), /incompatible/);
});

test("malformed child IPC fails only its supervisor", async () => {
  const descriptor = await fixture("example.malformed", "export function activate() {}");
  const childEntrypoint = join(descriptor.packageRoot, "malformed-child.cjs");
  await writeFile(childEntrypoint, `process.on("message", () => process.send({ totally: "invalid" }));`);
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} }, childEntrypoint });
  await assert.rejects(host.start(descriptor), /malformed child message/);
  assert.equal(host.status().state, "failed");
});

test("oversized and late child results are rejected or ignored without poisoning later calls", async () => {
  const oversized = await fixture("example.oversized", `export function activate() { return { methods: { huge() { return "x".repeat(300000); } } }; }`);
  const oversizedHost = new ExtensionHost(oversized.extensionId, { broker: { async request() {} }, limits: { maxMessageBytes: 8_000 } });
  await oversizedHost.start(oversized);
  await assert.rejects(oversizedHost.invoke({ method: "huge" }), /oversized child message|exited/);
  assert.equal(oversizedHost.status().state, "failed");

  const late = await fixture("example.late", `export function activate() { return { methods: {
    late() { return new Promise(resolve => setTimeout(() => resolve("too late"), 40)); }, ping() { return "pong"; }
  } }; }`);
  const lateHost = new ExtensionHost(late.extensionId, { broker: { async request() {} } });
  await lateHost.start(late);
  await assert.rejects(lateHost.invoke({ method: "late", deadlineMs: 5 }), /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(await lateHost.invoke({ method: "ping" }), "pong");
  await lateHost.stop();
});

test("duplicate provider ids are rejected before provider publication", async () => {
  const descriptor = await fixture("example.collision", `export function activate(context) {
    const definition = { providerId: "example.collision/main", displayName: "Main", capabilities: ["terminal"] };
    context.registerProjectEnvironmentProvider(definition); context.registerProjectEnvironmentProvider(definition);
  }`);
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} } });
  await assert.rejects(host.start(descriptor), /invalid provider registrations/);
  assert.deepEqual(host.status().providers, []);
});

test("embedded and standalone supervisors publish the same safe provider DTO and cannot block This server readiness", async () => {
  const descriptor = await fixture("example.portable", `export default { activate(context) {
    context.registerProjectEnvironmentProvider({ providerId: "example.portable/main", displayName: "Portable", description: "Safe text", capabilities: ["terminal", "filesystem"] });
  } };`);
  const states = [];
  for (const runtimeMode of ["embedded", "standalone"]) {
    let thisServerReady = true;
    const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} } });
    await host.start(descriptor);
    states.push({ runtimeMode, providers: host.status().providers });
    assert.equal(thisServerReady, true);
    assert.equal(JSON.stringify(host.status().providers).includes("function"), false);
    await host.stop();
    thisServerReady = true;
  }
  assert.deepEqual(states[0].providers, states[1].providers);
});

test("provider callbacks preserve bounded context and dependency handoff across IPC", async () => {
  const descriptor = await fixture("example.callbacks", `export default { activate(context) {
    context.registerProjectEnvironmentProvider({
      definition: { providerId: "example.callbacks/main", displayName: "Callbacks", capabilities: ["terminal"] },
      runtime: {
        async testProfile(request, call) { await call.dependencies.call({ providerId: "dependency/main", operation: "validate", payload: request.values }, { deadlineAt: call.deadlineAt, signal: call.signal, idempotencyKey: call.idempotencyKey }); return []; },
        async resolveOptions() { return { options: [{ value: "one", label: "One" }] }; },
        async createEnvironment(request, call) { return { state: "ready", providerState: { key: request.environmentId, idempotencyKey: call.idempotencyKey, expectedRevision: call.expectedRevision }, status: { state: "available", revision: 1, defaultRoot: "/home/user" } }; },
        async resumeOperation(request) { return { state: "pending", operationId: request.operationId, providerState: request.providerState, progress: { operationId: request.operationId, title: "Working", resumable: true, stages: [] }, pollAfterMs: 100 }; },
        async getStatus() { return { state: "available", revision: 2 }; },
        async invokeAction(request) { return { state: "complete", providerState: request.providerState, status: { state: "available", revision: 3 } }; }
      }
    });
  } };`);
  const brokerRequests = [];
  const manager = new ExtensionHostManager({ broker: { async request(request) { brokerRequests.push(request); return { ok: true }; } } });
  await manager.start(descriptor);
  const providerId = "example.callbacks/main";
  assert.deepEqual(await manager.invokeProvider({ providerId, callback: "resolveOptions", request: { sourceId: "images", values: {} } }), { options: [{ value: "one", label: "One" }] });
  const created = await manager.invokeProvider({ providerId, callback: "createEnvironment", request: { environmentId: "env-1", displayName: "VM", values: {} }, idempotencyKey: "idem-1", expectedRevision: 7 });
  assert.deepEqual(created.providerState, { key: "env-1", idempotencyKey: "idem-1", expectedRevision: 7 });
  assert.equal(created.status.defaultRoot, "/home/user");
  assert.deepEqual(await manager.invokeProvider({ providerId, callback: "getStatus", request: { environmentId: "env-1", providerState: {} } }), { state: "available", revision: 2 });
  assert.deepEqual(await manager.invokeProvider({ providerId, callback: "testProfile", request: { values: { url: "https://example.test" } }, idempotencyKey: "test-1" }), []);
  assert.equal(brokerRequests[0].extensionId, "example.callbacks");
  assert.equal(brokerRequests[0].operation, "provider.call");
  assert.equal(brokerRequests[0].payload.request.providerId, "dependency/main");
  await manager.shutdown();
});

test("provider callbacks reject unsafe DTOs and honor cancellation and deadlines", async () => {
  const descriptor = await fixture("example.hostile-runtime", `export function activate(context) {
    context.registerProjectEnvironmentProvider({
      definition: { providerId: "example.hostile-runtime/main", displayName: "Hostile", capabilities: ["terminal"] },
      runtime: {
        async testProfile() { return []; }, async resolveOptions() { return { options: [{ value: "x", label: "X", injected: "bad" }] }; },
        async createEnvironment(_request, call) { return new Promise((_resolve, reject) => call.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); },
        async resumeOperation() { return { state: "pending", operationId: "x", providerState: {}, progress: { operationId: "x", title: "x", resumable: true, stages: [] } }; },
        async getStatus() { return { state: "available", revision: 1 }; },
        async invokeAction(request) { return { state: "complete", providerState: request.providerState, status: { state: "available", revision: 1 } }; },
        async invokeService(request) {
          if (request.operation === "read") return { data: "not canonical base64", encoding: "base64", secret: "must-not-cross" };
          if (request.operation === "input") return { accepted: false };
          return { accepted: true };
        }
      }
    });
  }`);
  const manager = new ExtensionHostManager({ broker: { async request() {} } });
  await manager.start(descriptor);
  const providerId = "example.hostile-runtime/main";
  await assert.rejects(manager.invokeProvider({ providerId, callback: "resolveOptions", request: { sourceId: "x", values: {} } }), /invalid options/);
  await assert.rejects(manager.invokeProvider({ providerId, callback: "createEnvironment", request: { environmentId: "env", displayName: "VM", values: {} }, deadlineMs: 10 }), /timed out/);
  const controller = new AbortController();
  const pending = manager.invokeProvider({ providerId, callback: "createEnvironment", request: { environmentId: "env", displayName: "VM", values: {} }, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal((await manager.invokeProvider({ providerId, callback: "getStatus", request: { environmentId: "env", providerState: {} } })).state, "available");
  const serviceBase = { environmentId: "env", providerState: {}, capability: "terminal", projectId: "project", environmentRevision: 1, input: {} };
  await assert.rejects(manager.invokeProvider({ providerId, callback: "invokeService", request: { ...serviceBase, operation: "input" } }), /terminal acknowledgement/);
  await assert.rejects(manager.invokeProvider({ providerId, callback: "invokeService", request: { ...serviceBase, operation: "read" } }), /terminal read|oversized/);
  await assert.rejects(manager.invokeProvider({ providerId, callback: "invokeService", request: { ...serviceBase, capability: "infrastructure", operation: "run" } }), /unsupported service capability/);
  await manager.shutdown();
});

test("provider profile and secret brokers enforce ownership and zeroize child bytes", async () => {
  const descriptor = await fixture("example.credentials", `export function activate(context) {
    context.registerProjectEnvironmentProvider({ definition: { providerId: "example.credentials/main", displayName: "Credentials", capabilities: ["terminal"] }, runtime: {
      async testProfile(request, call) {
        const profile = await call.profiles.get(request.profileId);
        let retained;
        const decoded = await call.secrets.withValue({ profileId: request.profileId, fieldId: "apiKey", purpose: "test" }, bytes => { retained = bytes; return new TextDecoder().decode(bytes); });
        return retained.every(byte => byte === 0) && profile.values.url && decoded === "secret-sentinel" ? [] : [{ code: "failed", message: "broker contract failed" }];
      },
      async resolveOptions(){ return {options:[]}; }, async createEnvironment(){ throw new Error("unused"); }, async resumeOperation(){ throw new Error("unused"); },
      async getStatus(){ return {state:"available",revision:1}; }, async invokeAction(request){ return {state:"complete",providerState:request.providerState,status:{state:"available",revision:1}}; }
    }});
  }`);
  let parentCopy;
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() { throw new Error("unexpected generic broker"); } },
    profiles: { async get(extensionId, providerId, profileId) { assert.equal(extensionId, "example.credentials"); assert.equal(providerId, "example.credentials/main"); assert.equal(profileId, "profile-1"); return { profileId, providerId, revision: 2, values: { url: "https://example.test" }, secretFields: ["apiKey"] }; } },
    secrets: { async withSecret(principal, request, use) { assert.equal(principal.extensionId, "example.credentials"); assert.equal(request.profileId, "profile-1"); parentCopy = new TextEncoder().encode("secret-sentinel"); try { return await use(parentCopy); } finally { parentCopy.fill(0); } } },
  });
  await host.start(descriptor);
  assert.deepEqual(await host.invokeProvider({ providerId: "example.credentials/main", callback: "testProfile", request: { profileId: "profile-1", values: {} } }), []);
  assert.equal(parentCopy.every((byte) => byte === 0), true);
  await assert.rejects(host.invokeProvider({ providerId: "example.other/main", callback: "testProfile", request: { profileId: "profile-1", values: {} } }), /not registered/);
  await host.stop();
});

test("observation service results are closed, bounded, and state explicit", async () => {
  const descriptor = await fixture("example.observation", `export function activate(context) { context.registerProjectEnvironmentProvider({ definition:{providerId:"example.observation/main",displayName:"Observation",capabilities:["filesystem-observation","process-observation"]}, runtime:{
    async testProfile(){return []},async resolveOptions(){return {options:[]}},async createEnvironment(){throw new Error("unused")},async resumeOperation(){throw new Error("unused")},async getStatus(){return {state:"available",revision:1}},async invokeAction(request){return {state:"complete",providerState:request.providerState,status:{state:"available",revision:1}}},
    async invokeService(request){if(request.capability==="filesystem-observation")return request.operation==="observe"?{observationId:"watch",mode:"bounded-polling",minimumPollMs:250,state:"resync-required",root:"/work"}:{observationId:"watch",state:"changes",revision:2,events:[{kind:"changed",path:"/work/a"}]};return request.operation==="observe"?{observationId:"process",protocol:"terminay-target-helper/process-v1",version:1,state:"starting"}:{observationId:"process",state:"available",cwd:"/work",foregroundProcess:"codex",observedAt:Date.now(),leak:"bad"}}
  }});}`);
  const manager = new ExtensionHostManager({ broker: { async request() {} } }); await manager.start(descriptor); const providerId="example.observation/main";
  const base={environmentId:"env",providerState:{},projectId:"project",environmentRevision:1,input:{}};
  assert.equal((await manager.invokeProvider({providerId,callback:"invokeService",request:{...base,capability:"filesystem-observation",operation:"observe"}})).state,"resync-required");
  assert.equal((await manager.invokeProvider({providerId,callback:"invokeService",request:{...base,capability:"filesystem-observation",operation:"poll"}})).events.length,1);
  assert.equal((await manager.invokeProvider({providerId,callback:"invokeService",request:{...base,capability:"process-observation",operation:"observe"}})).state,"starting");
  await assert.rejects(manager.invokeProvider({providerId,callback:"invokeService",request:{...base,capability:"process-observation",operation:"poll"}}),/invalid process observation poll/);
  await manager.shutdown();
});

test("SSH agent broker is explicit, permission-scoped, and child environment stays sterile", async () => {
  const source = `export function activate(context) { context.registerProjectEnvironmentProvider({ definition:{providerId:"example.agent/main",displayName:"Agent",capabilities:["terminal"]}, runtime:{
    async testProfile(request, call) { const identities = await call.sshAgent.listIdentities({profileId:request.profileId,purpose:"ssh-user-authentication"}); return identities.length === 1 && process.env.SSH_AUTH_SOCK === undefined ? [] : [{code:"bad",message:"agent contract failed"}]; },
    async resolveOptions(){return {options:[]}}, async createEnvironment(){throw new Error("unused")}, async resumeOperation(){throw new Error("unused")}, async getStatus(){return {state:"available",revision:1}}, async invokeAction(request){return {state:"complete",providerState:request.providerState,status:{state:"available",revision:1}}}
  }}); }`;
  const permitted = await fixture("example.agent", source); permitted.permissions = ["ssh-agent:use"];
  const identity = { identityId: "identity-1", algorithm: "ssh-ed25519", publicKey: new Uint8Array([1,2,3]), fingerprint: "SHA256:fixture" };
  const host = new ExtensionHost(permitted.extensionId, { broker:{async request(){}}, sshAgent:{ async listIdentities(principal){ assert.equal(principal.profileId,"profile-1"); return [identity]; }, async sign(){ return {algorithm:"ssh-ed25519",signature:new Uint8Array([4,5])}; } } });
  await host.start(permitted);
  assert.deepEqual(await host.invokeProvider({providerId:"example.agent/main",callback:"testProfile",request:{profileId:"profile-1",values:{}}}), []);
  await host.stop();
  const denied = await fixture("example.agent-denied", source.replaceAll("example.agent/main", "example.agent-denied/main"));
  const deniedHost = new ExtensionHost(denied.extensionId, { broker:{async request(){}}, sshAgent:{async listIdentities(){return [identity]},async sign(){throw new Error("unused")}} });
  await deniedHost.start(denied);
  await assert.rejects(deniedHost.invokeProvider({providerId:"example.agent-denied/main",callback:"testProfile",request:{profileId:"profile-1",values:{}}}), /SSH agent access is denied/);
  await deniedHost.stop();
});

test("agent providers require a manifest declaration and receive only parent-admitted terminal contexts", async () => {
  const descriptor = await fixture("example.agent-runtime", `export function activate(context) {
    context.agents.registerProvider("example.agent-runtime/cli", {
      mappingVersion: "0.1",
      matchesForeground() { return true; },
      async observe(terminal) {
        const descendants = await terminal.observation.processes.descendants();
        const binding = await terminal.bindSession({ providerSessionId: "session-1", mappingVersion: "0.1", fingerprint: { kind: "fixture" } });
        return { state: "bound", binding,
          source: { async *[Symbol.asyncIterator]() { yield { bytes: new TextEncoder().encode(JSON.stringify({ type: "started", title: descendants.name }) + "\\n") }; } },
          childSources: [{ childId: "child-1", journal: { id: "child-journal" }, source: { async *[Symbol.asyncIterator]() { yield { bytes: new TextEncoder().encode('{"type":"child"}\\n') }; } } }],
          childSourceDiscovery: { async *[Symbol.asyncIterator]() { yield { childId: "child-2", journal: { id: "child-journal-2" }, source: { async *[Symbol.asyncIterator]() { yield { bytes: new TextEncoder().encode('{"type":"child"}\\n') }; } } }; } },
          mapRecord(record, session) { if (record.type === "started") return session.publish.sessionStarted({ title: record.title }); if (record.type === "child" && session.journal.role === "child") return session.publish.subagentStarted({ subagentId: session.journal.childId, title: "Child" }); }
        };
      }
    });
  }`);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{
    id: "example.agent-runtime/cli", displayName: "Fixture CLI",
    requiredEnvironmentCapabilities: ["process-observation"],
  }];
  const observations = [];
  const publications = [];
  const cancellations = [];
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    agents: {
      async observe(request) {
        observations.push(request);
        return { name: "fixture-agent" };
      },
      async publish(request) {
        publications.push(request);
        return { acceptedEventCount: request.events.length };
      },
      terminalCancelled(request) { cancellations.push(request); },
    },
  });
  await host.start(descriptor);
  assert.deepEqual(host.status().agentProviders.map((provider) => provider.id), ["example.agent-runtime/cli"]);
  await host.admitAgentTerminal({
    context: { contextId: "context-1", serverId: "server-1", projectId: "project-1", projectEnvironmentId: "environment-1", terminalSessionId: "terminal-1", terminalIncarnationId: "incarnation-1", providerId: "example.agent-runtime/cli" },
    observationCapabilities: ["process-observation"],
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].terminal.terminalSessionId, "terminal-1");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(publications.length, 5, "binding, provisional root, root enrichment, static child and late child lifecycle events publish separately");
  assert.equal(publications[1].events[0].kind, "session.started");
  assert.deepEqual(publications[2].events[0], { kind: "agent.metadata", title: "fixture-agent" });
  assert.deepEqual(publications[3].events[0], { kind: "subagent.started", subagentId: "child-1", title: "Child" });
  assert.deepEqual(publications[4].events[0], { kind: "subagent.started", subagentId: "child-2", title: "Child" });
  assert.equal(await host.cancelAgentTerminal({ contextId: "context-1", reason: "terminal-closed" }), true);
  assert.equal(cancellations.length, 1);
  assert.equal(await host.cancelAgentTerminal({ contextId: "context-1", reason: "terminal-closed" }), false, "teardown is exactly once");
  await host.stop();
});

test("an oversized agent observation result fails that observe without killing the extension host", async () => {
  const descriptor = await fixture("example.agent-oversize", `export function activate(context) {
    context.agents.registerProvider("example.agent-oversize/cli", {
      mappingVersion: "0.1", matchesForeground() { return true; },
      async observe(terminal) {
        try { await terminal.observation.processes.descendants(); return { state: "not-bound" }; }
        catch { return { state: "not-bound" }; }
      }
    });
  }`);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{
    id: "example.agent-oversize/cli", displayName: "Oversize fixture",
    requiredEnvironmentCapabilities: ["process-observation"],
  }];
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    limits: { maxMessageBytes: 4_096 },
    agents: {
      async observe() { return { pad: "x".repeat(8_000) }; },
      async publish(request) { return { acceptedEventCount: request.events.length }; },
      terminalCancelled() {},
    },
  });
  await host.start(descriptor);
  await host.admitAgentTerminal({
    context: {
      contextId: "context-oversize", serverId: "server-1", projectId: "project-1",
      projectEnvironmentId: "environment-1", terminalSessionId: "terminal-1",
      terminalIncarnationId: "incarnation-1", providerId: "example.agent-oversize/cli",
    },
    observationCapabilities: ["process-observation"],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(host.status().state, "running");
  await host.stop();
});

test("a running extension manager exposes its agent provider and admits the exact terminal context", async () => {
  const descriptor = await fixture("example.agent-manager", `export function activate(context) {
    context.agents.registerProvider("example.agent-manager/cli", {
      mappingVersion: "0.1", matchesForeground() { return true; },
      async observe(terminal) { await terminal.observation.processes.descendants(); return { state: "not-bound" }; }
    });
  }`);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{
    id: "example.agent-manager/cli", displayName: "Manager fixture",
    requiredEnvironmentCapabilities: ["process-observation"],
  }];
  const observations = [];
  const manager = new ExtensionHostManager({
    broker: { async request() {} },
    agents: {
      async observe(request) { observations.push(request); return { name: "fixture-agent" }; },
      async publish(request) { return { acceptedEventCount: request.events.length }; },
      terminalCancelled() {},
    },
  });
  await manager.start(descriptor);
  assert.deepEqual(manager.agentProviderContributions().map((value) => value.id), ["example.agent-manager/cli"]);
  await manager.admitAgentTerminal({
    context: {
      contextId: "context-manager-1", serverId: "server-1", projectId: "project-1",
      projectEnvironmentId: "environment-1", terminalSessionId: "terminal-1",
      terminalIncarnationId: "incarnation-1", providerId: "example.agent-manager/cli",
    },
    observationCapabilities: ["process-observation"],
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].terminal.contextId, "context-manager-1");
  await manager.shutdown();
});

test("a shell return cancels the real extension-child observer before its journal can outlive the PTY", async (t) => {
  const descriptor = await fixture("example.agent-shell-return", `export function activate(context) {
    context.agents.registerProvider("example.agent-shell-return/cli", {
      mappingVersion: "0.1", matchesForeground() { return true; },
      async observe() { return { state: "not-bound" }; }
    });
  }`);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{
    id: "example.agent-shell-return/cli", displayName: "Shell return fixture",
    processMatchers: [{ executableName: "codex" }],
    requiredEnvironmentCapabilities: [],
  }];
  const manager = new ExtensionHostManager({
    broker: { async request() {} },
    agents: { async observe() { return {}; }, async publish(request) { return { acceptedEventCount: request.events.length }; } },
  });
  const identity = { serverId: "server-shell-return", projectId: "project-shell-return", sessionId: "terminal-shell-return" };
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  t.after(async () => { await manager.shutdown().catch(() => undefined); await agents.stop().catch(() => undefined); });
  await manager.start(descriptor);
  const admitted = [];
  const runtime = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => manager.agentProviderContributions(),
      async admitAgentTerminal(value) { admitted.push(value); return manager.admitAgentTerminal(value); },
      cancelAgentTerminal: (value) => manager.cancelAgentTerminal(value),
      drainAgentObservers: (reason) => manager.drainAgentObservers(reason),
    },
  });
  runtime.register(identity);
  assert.equal(runtime.foregroundProcessChanged(identity, "codex"), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(admitted.length, 1);
  const contextId = admitted[0].context.contextId;

  assert.equal(runtime.foregroundProcessChanged(identity, "zsh", true), false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.observationTerminal(admitted[0].context), undefined);
  assert.equal(await manager.cancelAgentTerminal({ contextId, reason: "terminal-replaced" }), false,
    "the runtime's shell-return cancellation reached the child-owned context exactly once");
});

test("agent registration fails closed when a child registers a provider not declared by its manifest", async () => {
  const descriptor = await fixture("example.agent-undeclared", `export function activate(context) {
    context.agents.registerProvider("example.agent-undeclared/other", { mappingVersion: "0.1", matchesForeground() { return true; }, async observe() { return { state: "not-bound" }; } });
  }`);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{ id: "example.agent-undeclared/cli", displayName: "Declared", requiredEnvironmentCapabilities: [] }];
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request() {} } });
  await assert.rejects(host.start(descriptor), /undeclared or invalid/);
  assert.deepEqual(host.status().agentProviders, []);
});

test("dependency calls authenticate the caller, enforce manifest operation allowlists, and keep vault bytes private", async () => {
  const target = await fixture("example.target", `export function activate(context) { context.registerProjectEnvironmentProvider({
    definition: { providerId: "example.target/main", displayName: "Target", capabilities: ["terminal"] },
    runtime: { testProfile: async()=>[], resolveOptions:async()=>({options:[]}), createEnvironment:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}), resumeOperation:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}), getStatus:async()=>({state:"available",revision:1}), invokeAction:async()=>({state:"complete",providerState:{},status:{state:"available",revision:1}}) },
    dependencyOperations: { async call(request, context) { const stored = await context.vault.put({ bindingKey:"primary", purpose:"fixture", value:new Uint8Array([11,22,33]), idempotencyKey:context.idempotencyKey }); return context.vault.withSecret({binding:stored.binding,purpose:"fixture"}, bytes => ({ operation:request.operation, byteCount:bytes.length, binding:stored.binding, revision:stored.revision })); } }
  }); }`);
  target.permissions = []; target.projectEnvironmentProviders = [{ id: "example.target/main", displayName: "Target", capabilities: ["terminal"], dependencyOperations: [{ name: "credential.generate" }] }];
  const caller = await fixture("example.caller", `export function activate(context) { context.registerProjectEnvironmentProvider({ definition:{providerId:"example.caller/main",displayName:"Caller",capabilities:["terminal"]}, runtime:{ testProfile:async()=>[], async resolveOptions(_request, call) { const result=await call.dependencies.call({providerId:"example.target/main",operation:"credential.generate",payload:{}},{deadlineAt:call.deadlineAt,signal:call.signal,idempotencyKey:"generate-1"}); return {options:[{value:JSON.stringify(result),label:"Result"}]}; }, createEnvironment:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}), resumeOperation:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}), getStatus:async()=>({state:"available",revision:1}), invokeAction:async()=>({state:"complete",providerState:{},status:{state:"available",revision:1}}) } }); }`);
  caller.permissions = ["provider:depend"]; caller.extensionDependencies = [{ extensionId: "example.target", apiRange: "^1.1.0" }];
  const manager = new ExtensionHostManager({ broker:{async request(){}}, vault: memoryVault() });
  await manager.start(target); await manager.start(caller);
  const options = await manager.invokeProvider({ providerId:"example.caller/main", callback:"resolveOptions", request:{sourceId:"fixture",values:{}}, idempotencyKey:"outer", deadlineMs:1000 });
  const result=JSON.parse(options.options[0].value);
  assert.deepEqual(result, { operation:"credential.generate", byteCount:3, binding:{bindingRef:result.binding.bindingRef}, revision:1 });
  assert.match(result.binding.bindingRef, /^pvb_/); assert.equal(JSON.stringify(result).includes("11"), false);
  await manager.shutdown();
});

test("dependency routing rejects undeclared callers and undeclared target operations", async () => {
  const target = await fixture("secure.target", `export function activate(context){context.registerProjectEnvironmentProvider({definition:{providerId:"secure.target/main",displayName:"Target",capabilities:["terminal"]},runtime:{testProfile:async()=>[],resolveOptions:async()=>({options:[]}),createEnvironment:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}),resumeOperation:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}),getStatus:async()=>({state:"available",revision:1}),invokeAction:async()=>({state:"complete",providerState:{},status:{state:"available",revision:1}})},dependencyOperations:{async call(){return [];}}});}`);
  target.projectEnvironmentProviders = [{ id:"secure.target/main", displayName:"Target", capabilities:["terminal"], dependencyOperations:[{name:"allowed"}] }];
  const caller = await fixture("secure.caller", `export function activate(context){context.registerProjectEnvironmentProvider({definition:{providerId:"secure.caller/main",displayName:"Caller",capabilities:["terminal"]},runtime:{async testProfile(_r,c){return c.dependencies.call({providerId:"secure.target/main",operation:"denied",payload:{}},{deadlineAt:c.deadlineAt,signal:c.signal});},resolveOptions:async()=>({options:[]}),createEnvironment:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}),resumeOperation:async()=>({state:"ready",providerState:{},status:{state:"available",revision:1}}),getStatus:async()=>({state:"available",revision:1}),invokeAction:async()=>({state:"complete",providerState:{},status:{state:"available",revision:1}})}});}`);
  caller.permissions=["provider:depend"]; caller.extensionDependencies=[{extensionId:"secure.target",apiRange:"^1.1.0"}];
  const manager=new ExtensionHostManager({broker:{async request(){}},vault:memoryVault()}); await manager.start(target); await manager.start(caller);
  await assert.rejects(manager.invokeProvider({providerId:"secure.caller/main",callback:"testProfile",request:{values:{}},deadlineMs:1000}), /not declared/);
  await manager.shutdown();
});
