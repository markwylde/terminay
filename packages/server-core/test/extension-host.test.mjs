import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTENSION_API_VERSION } from "@terminay/extension-api";
import {
  ExtensionHost,
  ExtensionHostManager,
  ServerVaultService,
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

const SOURCE_EXTENSION = `
export function activate(context) {
  context.agents.registerSessionSource("example.sources/agents", {
    start({ enabledHarnesses, publisher, signal, onEnabledHarnessesChanged }) {
      publisher.reset([{ id: "s1", harness: "fixture", pid: 101, cwd: "/work/app", status: "running", title: process.env.FIXTURE_HOME ?? "no-home" }]);
      publisher.upsert({ id: "s2", harness: "fixture", pid: 102, cwd: "/work/app", status: "idle" });
      publisher.remove("s2");
      publisher.upsert({ id: "s3", harness: "fixture", pid: 103, cwd: "/work/app", status: "waiting", waitingFor: String(enabledHarnesses.length) });
      publisher.diagnostic({ code: "degraded-process-watch", message: "koffi unavailable" });
      onEnabledHarnessesChanged((enabled) => publisher.upsert({ id: "s4", harness: "fixture", pid: 104, cwd: "/work/app", title: enabled.join(",") || "none" }));
      signal.addEventListener("abort", () => { globalThis.stopped = true; });
    },
  });
  context.mcp.registerInstallTarget("example.sources/client", {
    async status({ server }) { return { state: "installed", configPath: "/home/.client.json", message: server.command }; },
    async install() { return { ok: true, installed: true }; },
    async uninstall() { return { ok: "yes" }; },
  });
}`;

function sourceDescriptor(descriptor) {
  descriptor.permissions = ["agent-observation", "mcp-registration"];
  descriptor.agentSessionSources = [{
    id: "example.sources/agents",
    displayName: "Fixture Agents",
    harnesses: [{ id: "fixture", displayName: "Fixture" }],
    environmentVariables: ["FIXTURE_HOME"],
  }];
  descriptor.mcpInstallTargets = [{ id: "example.sources/client", displayName: "Client" }];
  return descriptor;
}

function recordingBroker() {
  const publications = [];
  const diagnostics = [];
  const stopped = [];
  return {
    publications, diagnostics, stopped,
    async publish(request) { publications.push(structuredClone(request)); return { ok: true }; },
    diagnostic(request) { diagnostics.push(request); },
    sourceStopped(request) { stopped.push(request.sourceId); },
  };
}

async function eventually(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("manager publishes a complete contribution set only after activation", async () => {
  const descriptor = sourceDescriptor(await fixture("example.sources", `export async function activate(context) { await new Promise((resolve) => setTimeout(resolve, 40)); ${"context.agents.registerSessionSource(\"example.sources/agents\", { start() {} }); context.mcp.registerInstallTarget(\"example.sources/client\", { async status() {}, async install() {}, async uninstall() {} });"} }`));
  const manager = new ExtensionHostManager({ broker: { async request() {} }, agents: recordingBroker() });
  const start = manager.start(descriptor);
  assert.deepEqual(manager.sessionSourceContributions(), []);
  await start;
  assert.deepEqual(manager.sessionSourceContributions().map(({ contribution }) => contribution.id), ["example.sources/agents"]);
  assert.deepEqual(manager.mcpInstallTargetContributions().map(({ contribution }) => contribution.id), ["example.sources/client"]);
  await manager.shutdown();
});

test("a started source's publisher calls reach the broker coalesced and in order", async (t) => {
  const previous = process.env.FIXTURE_HOME;
  process.env.FIXTURE_HOME = "/custom/home";
  t.after(() => { if (previous === undefined) delete process.env.FIXTURE_HOME; else process.env.FIXTURE_HOME = previous; });
  const descriptor = sourceDescriptor(await fixture("example.sources", SOURCE_EXTENSION));
  const agents = recordingBroker();
  const host = new ExtensionHost("example.sources", { broker: { async request() {} }, agents });
  t.after(() => host.stop());
  await host.start(descriptor);
  await host.startSessionSource("example.sources/agents", ["fixture"]);
  await eventually(() => agents.publications.length > 0 && agents.diagnostics.length > 0);
  const [first] = agents.publications;
  assert.equal(first.extensionId, "example.sources");
  assert.equal(first.sourceId, "example.sources/agents");
  // One reset carrying the net result of every call made in that turn.
  assert.deepEqual(first.publication.reset.map((session) => session.id), ["s1", "s3"]);
  assert.equal(first.publication.reset[0].title, "/custom/home", "declared environment variables reach the child");
  assert.equal(first.publication.reset[1].waitingFor, "1");
  assert.deepEqual(agents.diagnostics[0].diagnostic, { code: "degraded-process-watch", message: "koffi unavailable" });
  await host.setSessionSourceHarnesses("example.sources/agents", []);
  await eventually(() => agents.publications.some((request) => request.publication.upserts?.some((session) => session.id === "s4")));
  const s4 = agents.publications.flatMap((request) => request.publication.upserts ?? []).find((session) => session.id === "s4");
  assert.equal(s4.title, "none");
  await host.stopSessionSource("example.sources/agents");
  assert.deepEqual(agents.stopped, ["example.sources/agents"]);
});

test("a child that dies stops every running source exactly once", async (t) => {
  const descriptor = sourceDescriptor(await fixture("example.sources", SOURCE_EXTENSION.replace("signal.addEventListener", "setTimeout(() => process.exit(9), 20); signal.addEventListener")));
  const agents = recordingBroker();
  const host = new ExtensionHost("example.sources", { broker: { async request() {} }, agents, limits: { initialBackoffMs: 60_000 } });
  t.after(() => host.stop());
  await host.start(descriptor);
  await host.startSessionSource("example.sources/agents", ["fixture"]);
  await eventually(() => agents.stopped.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(agents.stopped, ["example.sources/agents"]);
  assert.equal(host.status().state, "failed");
});

test("MCP install targets are invoked with the host command and their results validated", async (t) => {
  const descriptor = sourceDescriptor(await fixture("example.sources", SOURCE_EXTENSION));
  const manager = new ExtensionHostManager({ broker: { async request() {} }, agents: recordingBroker() });
  t.after(() => manager.shutdown());
  await manager.start(descriptor);
  const server = { command: "/opt/terminay", args: ["/entry.js"], env: { ELECTRON_RUN_AS_NODE: "1" } };
  assert.deepEqual(await manager.invokeMcpTarget("example.sources/client", "status", server), { state: "installed", configPath: "/home/.client.json", message: "/opt/terminay" });
  assert.deepEqual(await manager.invokeMcpTarget("example.sources/client", "install", server), { ok: true, installed: true });
  await assert.rejects(manager.invokeMcpTarget("example.sources/client", "uninstall", server), /invalid result/);
  await assert.rejects(manager.invokeMcpTarget("example.sources/missing", "status", server), /unavailable/);
  await assert.rejects(manager.invokeMcpTarget("example.sources/client", "status", { command: 7 }), /invalid/);
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
    api: "^3.0.0",
    engines: { terminay: ">=1", node: ">=22" },
    entrypoint: descriptor.entrypoint,
    permissions: ["agent-observation"],
    contributes: { agentSessionSources: [{ id: "example.manifest/provider", displayName: "Fixture", harnesses: [{ id: "fixture", displayName: "Fixture" }] }] },
  };
  const launch = await extensionLaunchDescriptor({ ...descriptor, manifest });
  assert.equal(launch.descriptor.extensionId, descriptor.extensionId);
  await assert.rejects(extensionLaunchDescriptor({ ...descriptor, manifest: { ...manifest, unexpected: true } }), /Invalid Terminay extension manifest/);
});

test("validated agent manifest contributions are threaded into the launch descriptor", async () => {
  const input = await fixture("example.manifest-agent", "export function activate() {}");
  const manifest = {
    manifestVersion: 1, id: input.extensionId, displayName: "Manifest agent", api: "^3.0.0",
    engines: { terminay: ">=1", node: ">=22" }, entrypoint: input.entrypoint,
    permissions: ["agent-observation", "mcp-registration"],
    contributes: {
      agentSessionSources: [{ id: "example.manifest-agent/agents", displayName: "Fixture", harnesses: [{ id: "fixture", displayName: "Fixture" }] }],
      mcpInstallTargets: [{ id: "example.manifest-agent/client", displayName: "Client" }],
    },
  };
  const launch = await extensionLaunchDescriptor({ ...input, manifest });
  assert.deepEqual(launch.descriptor.agentSessionSources, manifest.contributes.agentSessionSources);
  assert.deepEqual(launch.descriptor.mcpInstallTargets, manifest.contributes.mcpInstallTargets);
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
    manifestVersion: 1, id: "example.compat", displayName: "Compatibility", api: "^3.0.0",
    engines: { terminay: ">=1.0.0", node: ">=22.0.0" }, entrypoint: "extension.js", permissions: [],
    contributes: {},
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

test("registration fails closed when a child registers a source its manifest did not declare", async () => {
  const descriptor = sourceDescriptor(await fixture("example.sources", `export function activate(context) {
    context.agents.registerSessionSource("example.sources/other", { start() {} });
  }`));
  const host = new ExtensionHost("example.sources", { broker: { async request() {} }, agents: recordingBroker() });
  await assert.rejects(host.start(descriptor), /undeclared or invalid/);
  assert.deepEqual(host.status().agentSessionSources, []);
});

test("a source registered without agent-observation is refused", async () => {
  const descriptor = sourceDescriptor(await fixture("example.sources", SOURCE_EXTENSION));
  descriptor.permissions = ["mcp-registration"];
  const host = new ExtensionHost("example.sources", { broker: { async request() {} }, agents: recordingBroker() });
  await assert.rejects(host.start(descriptor), /invalid agent session source registrations/);
});

test("a publication for a source the host did not start is refused", async (t) => {
  const descriptor = sourceDescriptor(await fixture("example.sources", `export function activate(context) {
    let publisher;
    context.agents.registerSessionSource("example.sources/agents", { start(start) { publisher = start.publisher; } });
    return { methods: { async ping() { return "ok"; } } };
  }`));
  const agents = recordingBroker();
  const host = new ExtensionHost("example.sources", { broker: { async request() {} }, agents });
  t.after(() => host.stop());
  await host.start(descriptor);
  assert.equal(await host.invoke({ method: "ping" }), "ok");
  assert.deepEqual(agents.publications, []);
});
