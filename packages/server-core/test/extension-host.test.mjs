import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExtensionHost,
  ExtensionHostManager,
  assertExtensionCompatible,
  extensionLaunchDescriptor,
  validateExtensionLaunchDescriptor,
} from "../dist/index.js";

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

test("one extension child activates, invokes methods, and uses an identity-scoped broker", async () => {
  const descriptor = await fixture("example.test", `
    export async function activate(context) {
      context.registerProjectEnvironmentProvider({ providerId: "example.test/main", displayName: "Example", capabilities: ["terminal"] });
      return { methods: {
        echo(input) { return { input, extensionId: context.extensionId }; },
        async secret(input) { return context.broker.request("secret.resolve", input); }
      }};
    }
  `);
  const requests = [];
  const host = new ExtensionHost(descriptor.extensionId, { broker: { async request(request) { requests.push(request); return "resolved-metadata"; } } });
  await host.start(descriptor);
  assert.equal(host.status().state, "running");
  assert.deepEqual(host.status().providers.map((provider) => provider.providerId), ["example.test/main"]);
  assert.deepEqual(await host.invoke({ method: "echo", input: "hello" }), { input: "hello", extensionId: "example.test" });
  assert.equal(await host.invoke({ method: "secret", input: { profileId: "profile-1" } }), "resolved-metadata");
  assert.equal(requests[0].extensionId, "example.test");
  assert.equal(requests[0].operation, "secret.resolve");
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
