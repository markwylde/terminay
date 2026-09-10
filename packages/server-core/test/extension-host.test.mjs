import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTENSION_API_VERSION } from "@terminay/extension-api";
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
  assert.deepEqual(await host.invoke({ method: "echo", input: "hello" }), { input: "hello", extensionId: "example.test" });
  const runtime = await host.invoke({ method: "runtime" });
  assert.equal(runtime.electronRunAsNode, "1");
  assert.equal(runtime.nodeEnv, "production");
  assert.equal(runtime.apiVersion, EXTENSION_API_VERSION);
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
  const descriptor = await fixture("example.atomic", `export async function activate(context) { await new Promise((resolve) => setTimeout(resolve, 40)); context.agents.registerProvider("example.atomic/cli", { mappingVersion: "v1", matchesForeground() { return true; }, async observe() { return { state: "not-bound" }; } }); }`);
  descriptor.permissions = ["agent-observation"];
  descriptor.agentProviders = [{ id: "example.atomic/cli", displayName: "Atomic" }];
  const manager = new ExtensionHostManager({ broker: { async request() {} }, agents: { async observe() { return { name: "codex" }; }, async publish(request) { return { acceptedEventCount: request.events.length }; } } });
  const start = manager.start(descriptor);
  assert.deepEqual(manager.agentProviderContributions(), []);
  await start;
  assert.deepEqual(manager.agentProviderContributions().map(({ id }) => id), ["example.atomic/cli"]);
  await manager.shutdown();
});

test("an agent provider may read terminal environment variables through observation", async (t) => {
  const descriptor = await fixture("example.agent-environment", `
    export function activate(context) {
      context.agents.registerProvider("example.agent-environment/cli", {
        mappingVersion: "v1", matchesForeground() { return true; },
        async observe(terminal) {
          const allowed = await terminal.observation.processes.environment(["PROVIDER_HOME"], { signal: new AbortController().signal });
          if (allowed.PROVIDER_HOME !== "/fixture/provider") throw new Error("environment value was unavailable");
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
    requiredEnvironmentVariables: ["PROVIDER_HOME"],
  }];
  const observedNames = [];
  const host = new ExtensionHost(descriptor.extensionId, {
    broker: { async request() {} },
    agents: {
      async observe(request) {
        observedNames.push(request.payload.names);
        return { PROVIDER_HOME: "/fixture/provider" };
      },
      async publish(request) { return { acceptedEventCount: request.events.length }; },
    },
  });
  t.after(async () => { await host.stop().catch(() => undefined); });
  await host.start(descriptor);
  await host.admitAgentTerminal({
    context: {
      contextId: "fixture-context", serverId: "fixture-server", projectId: "fixture-project", terminalSessionId: "fixture-terminal",
      terminalIncarnationId: "1", providerId: "example.agent-environment/cli",
    },
    observationCapabilities: ["process-observation"],
  });
  assert.deepEqual(observedNames, [["PROVIDER_HOME"]]);
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
      contextId: "local-context", serverId: "server-1", projectId: "project-1", terminalSessionId: "terminal-1",
      terminalIncarnationId: "1", providerId: "example.agent-local-observe/cli",
      shellPid: process.pid,
    },
    observationCapabilities: ["process-observation"],
  });
  assert.equal(hostObservations, 0);
});

test("a running manager reconciles four late agents and re-admits an existing Codex terminal", async (t) => {
  const manager = new ExtensionHostManager({ broker: { async request() {} }, agents: { async observe() { return { name: "codex" }; }, async publish(request) { return { acceptedEventCount: request.events.length }; } } });
  t.after(async () => { await manager.shutdown().catch(() => undefined); });
  const identity = { serverId: "server-late", projectId: "project-late", sessionId: "terminal-late" };
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  t.after(async () => { await agents.stop().catch(() => undefined); });
  const failures = [];
  const runtime = new ExtensionAgentRuntimeRegistry({ agents, hosts: manager, reobserveDebounceMs: 0, onAdmissionFailure: (failure) => failures.push(failure) });
  manager.onContributionsChanged(() => { runtime.reobserveExistingTerminals(); });
  runtime.register(identity); runtime.terminalStarted(identity, 4242);
  assert.equal(runtime.foregroundProcessChanged(identity, "codex"), false, "no provider is installed yet");

  const lateAgents = [
    ["com.terminay.agent.codex", "codex", "Codex"],
    ["com.terminay.agent.claude-code", "claude", "Claude Code"],
    ["com.terminay.agent.grok", "grok", "Grok"],
    ["com.terminay.agent.omp", "omp", "omp"],
  ];
  for (const [extensionId, executable, displayName] of lateAgents) {
    const descriptor = await fixture(extensionId, `export function activate(context) { context.agents.registerProvider("${extensionId}/cli", { mappingVersion: "late-v1", matchesForeground() { return true; }, async observe(terminal) { await terminal.observation.processes.descendants(); const binding = await terminal.bindSession({ providerSessionId: "late-session", mappingVersion: "late-v1", fingerprint: { kind: "fixture" } }); return { state: "bound", binding, source: { async *[Symbol.asyncIterator]() { yield { bytes: new TextEncoder().encode('{"type":"started"}\\n') }; } }, mapRecord(record, session) { if (record.type === "started") return session.publish.sessionStarted({ title: "Late Codex" }); } }; } }); }`);
    descriptor.permissions = ["agent-observation"];
    descriptor.agentProviders = [{ id: `${extensionId}/cli`, displayName, processMatchers: [{ executableName: executable }] }];
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
    api: "^2.0.0",
    engines: { terminay: ">=1", node: ">=22" },
    entrypoint: descriptor.entrypoint,
    permissions: ["agent-observation"],
    contributes: { agentProviders: [{ id: "example.manifest/provider", displayName: "Fixture" }] },
  };
  const launch = await extensionLaunchDescriptor({ ...descriptor, manifest });
  assert.equal(launch.descriptor.extensionId, descriptor.extensionId);
  await assert.rejects(extensionLaunchDescriptor({ ...descriptor, manifest: { ...manifest, unexpected: true } }), /Invalid Terminay extension manifest/);
});

test("validated agent manifest contributions are threaded into the launch descriptor", async () => {
  const input = await fixture("example.manifest-agent", "export function activate() {}");
  const manifest = {
    manifestVersion: 1, id: input.extensionId, displayName: "Manifest agent", api: "^2.0.0",
    engines: { terminay: ">=1", node: ">=22" }, entrypoint: input.entrypoint,
    permissions: ["agent-observation"],
    contributes: { agentProviders: [{ id: "example.manifest-agent/cli", displayName: "Fixture CLI" }] },
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
    manifestVersion: 1, id: "example.compat", displayName: "Compatibility", api: "^2.0.0",
    engines: { terminay: ">=1.0.0", node: ">=22.0.0" }, entrypoint: "extension.js", permissions: [],
    contributes: {},
  };
  assert.doesNotThrow(() => assertExtensionCompatible(base, { terminayVersion: "1.4.0", nodeVersion: "24.0.0", platform: "linux" }));
  assert.throws(() => assertExtensionCompatible({ ...base, api: "^3.0.0" }, { terminayVersion: "1.4.0" }), /API/);
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
    context: { contextId: "context-1", serverId: "server-1", projectId: "project-1", terminalSessionId: "terminal-1", terminalIncarnationId: "incarnation-1", providerId: "example.agent-runtime/cli" },
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
      contextId: "context-oversize", serverId: "server-1", projectId: "project-1", terminalSessionId: "terminal-1",
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
      contextId: "context-manager-1", serverId: "server-1", projectId: "project-1", terminalSessionId: "terminal-1",
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
