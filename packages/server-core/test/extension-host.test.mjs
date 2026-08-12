import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExtensionHost,
  ExtensionHostManager,
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
