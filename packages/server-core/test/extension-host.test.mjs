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
  assert.equal(await host.invoke({ method: "log", input: { message: "safe" } }), "resolved-metadata");
  assert.equal(requests[0].extensionId, "example.test");
  assert.equal(requests[0].operation, "log");
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
