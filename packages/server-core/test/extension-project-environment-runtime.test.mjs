import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionProjectEnvironmentRuntime, registerActivatedExtensionProjectEnvironmentRuntimes } from "../dist/extensions/projectEnvironmentRuntime.js";
import { ProjectEnvironmentRegistry } from "../dist/projectEnvironment/registry.js";

const providerId = "com.terminay.ssh/connection";
const environment = {
  id: "env-ssh", providerId, profileId: "profile-1", pinnedRevision: 4,
  name: "SSH", endpointSummary: "dev@example", defaultRoot: "/work",
  declaredCapabilities: ["terminal", "filesystem"], availableCapabilities: ["terminal", "filesystem"],
  status: "ready", operationReferences: [], projectReferenceCount: 1,
  archived: false, builtIn: false, providerState: { opaque: "server-owned" }, providerRevision: 2,
};
const state = { schemaVersion: 2, serverId: "server-1", revision: 1, cursor: "1", profiles: {}, operations: {}, environments: { [environment.id]: environment } };
const context = { serverId: "server-1", projectId: "project-1", projectEnvironmentId: environment.id, environmentRevision: 4, deadline: Date.now() + 10_000, signal: new AbortController().signal };

test("extension service runtime injects canonical provider state and accepts only closed operations", async () => {
  const calls = [];
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["terminal", "filesystem"], { async invokeProvider(call) { calls.push(call); return { accepted: true }; } }, () => state);
  assert.deepEqual(await runtime.invoke("terminal", "input", { sessionId: "s", data: "x" }, context), { accepted: true });
  assert.deepEqual(calls[0].request, { environmentId: "env-ssh", profileId: "profile-1", providerState: { opaque: "server-owned" }, capability: "terminal", operation: "input", projectId: "project-1", environmentRevision: 4, input: { sessionId: "s", data: "x" } });
  await assert.rejects(runtime.invoke("terminal", "exec", {}, context), /unavailable/);
  await assert.rejects(runtime.invoke("git", "status", {}, context), /unavailable/);
});

test("extension terminal runtime resolves a deterministic first shell without asking the provider to implement a second launch protocol", async () => {
  let called = false;
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["terminal"], { async invokeProvider() { called = true; } }, () => state);
  const launch = await runtime.invoke("terminal", "resolve-launch", { cols: 80, rows: 24 }, context);
  assert.deepEqual(launch, {
    profile: { id: "environment:env-ssh:system-shell", revision: 4, name: "SSH shell", targetSummary: "dev@example", icon: "server" },
    shellPath: "/bin/sh",
    args: [],
    cwd: "/work",
  });
  assert.equal(called, false);
  await assert.rejects(runtime.invoke("terminal", "resolve-launch", { cols: 0, rows: 24 }, context), /launch input/);
});

test("extension terminal launch prefers the project's root over the environment default", async () => {
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["terminal"], { async invokeProvider() { throw new Error("provider launch"); } }, () => state);
  const launch = await runtime.invoke("terminal", "resolve-launch", { cols: 80, rows: 24, cwd: "/home/vms" }, context);
  assert.equal(launch.cwd, "/home/vms");
});

test("activated manifest contributions register and retire generic environment runtimes", async () => {
  const listeners = new Set(); const calls = [];
  let contributions = [{ id: providerId, displayName: "Direct", capabilities: ["terminal", "filesystem"] }];
  const hosts = {
    activatedProjectEnvironmentContributions: () => contributions,
    onContributionsChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async invokeProvider(call) { calls.push(call); return { accepted: true }; },
  };
  const registry = new ProjectEnvironmentRegistry();
  const registration = registerActivatedExtensionProjectEnvironmentRuntimes({ registry, hosts, snapshot: () => state });
  const runtime = registry.resolve(environment, "terminal");
  assert.deepEqual(await runtime.invoke("terminal", "input", { sessionId: "s", data: "x" }, context), { accepted: true });
  assert.equal(calls[0].providerId, providerId);
  contributions = [{ id: providerId, displayName: "Direct", capabilities: ["terminal", "filesystem", "git"] }];
  for (const listener of listeners) listener();
  assert.equal(registry.resolve(environment, "git").providerId, providerId);
  contributions = [];
  for (const listener of listeners) listener();
  assert.throws(() => registry.resolve(environment, "terminal"), /unavailable/);
  registration.dispose();
});

test("revision and provider changes fail closed before extension IPC", async () => {
  let called = false;
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["filesystem"], { async invokeProvider() { called = true; } }, () => state);
  await assert.rejects(runtime.invoke("filesystem", "list", {}, { ...context, environmentRevision: 3 }), /binding changed/);
  assert.equal(called, false);
});

test("oversized and non-JSON service inputs never reach the provider", async () => {
  let called = false;
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["terminal"], { async invokeProvider() { called = true; } }, () => state);
  await assert.rejects(runtime.invoke("terminal", "input", { sessionId: "s", data: "x".repeat(1024 * 1024 + 1) }, context), /invalid|too large/);
  await assert.rejects(runtime.invoke("terminal", "input", { executable() {} }, context), /invalid|unknown fields/);
  assert.equal(called, false);
});

test("observation services expose only their closed operation inputs", async () => {
  const calls = [];
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["filesystem-observation", "process-observation"], { async invokeProvider(call) { calls.push(call); return { accepted: true }; } }, () => ({ ...state, environments: { [environment.id]: { ...environment, declaredCapabilities: ["filesystem-observation","process-observation"], availableCapabilities: ["filesystem-observation","process-observation"] } } }));
  await runtime.invoke("filesystem-observation", "manualRefresh", { observationId: "watch-a" }, context);
  await runtime.invoke("process-observation", "poll", { observationId: "process-a", sessionId: "session-a" }, context);
  assert.equal(calls.length, 2);
  await assert.rejects(runtime.invoke("filesystem-observation", "poll", { observationId: "watch-a", injected: true }, context), /unknown fields/);
  await assert.rejects(runtime.invoke("process-observation", "report", { observationId: "process-a", sessionId: "session-a" }, context), /unavailable/);
});

test("Git service accepts only the routed protocol envelope", async () => {
  const calls = [];
  const gitEnvironment = { ...environment, declaredCapabilities: ["git"], availableCapabilities: ["git"] };
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["git"], { async invokeProvider(call) { calls.push(call); return { state: "not-repository", repositoryRoot: null, repositoryId: null, worktreeId: null }; } }, () => ({ ...state, environments: { [environment.id]: gitEnvironment } }));
  const input = { payload: { projectId: "project-1" }, request: { clientId: "client-1", authScope: "read" } };
  await runtime.invoke("git", "discover", input, context);
  assert.deepEqual(calls[0].request.input, input);
  await assert.rejects(runtime.invoke("git", "status", { ...input, executable: "git" }, context), /unknown fields/);
  await assert.rejects(runtime.invoke("git", "fetch", { payload: [], request: input.request }, context), /payload is invalid/);
});

test("prepare-project-root validates the requested remote directory and commit forgets a stale catalog", async () => {
  const calls = [];
  const runtime = new ExtensionProjectEnvironmentRuntime(
    providerId,
    ["filesystem"],
    { async invokeProvider(call) { calls.push(call); return { root: "/home/vms/test" }; } },
    () => state,
  );
  const prepared = await runtime.invoke("filesystem", "prepare-project-root", { root: "/home/vms/test" }, context);
  assert.equal(prepared.canonicalRoot, "/home/vms/test");
  assert.equal(typeof prepared.preparationId, "string");
  assert.equal(calls[0].request.operation, "resolveRoot");
  assert.deepEqual(calls[0].request.input, { root: "/home/vms/test" });
  assert.equal(await runtime.invoke("filesystem", "commit-project-root", { preparationId: prepared.preparationId }, context), null);
  await assert.rejects(runtime.invoke("filesystem", "commit-project-root", { preparationId: prepared.preparationId }, context), /not current/);
  await assert.rejects(runtime.invoke("filesystem", "prepare-project-root", { root: "/home/vms/test", extra: true }, context), /unknown fields/);
});

test("git discover uses the workspace project root", async () => {
  const calls = [];
  const gitEnvironment = { ...environment, declaredCapabilities: ["git"], availableCapabilities: ["git"] };
  const runtime = new ExtensionProjectEnvironmentRuntime(
    providerId,
    ["git"],
    { async invokeProvider(call) { calls.push(call); return { state: "not-repository", repositoryRoot: null, repositoryId: null, worktreeId: null }; } },
    () => ({ ...state, environments: { [environment.id]: gitEnvironment } }),
    () => "/home/vms/test",
  );
  await runtime.invoke("git", "discover", { payload: { projectId: "project-1" }, request: { clientId: "client-1", authScope: "read" } }, context);
  assert.equal(calls[0].request.input.root, "/home/vms/test");
});

test("spawn adapts bounded provider polling into PTY bytes, input, resize and exit", async () => {
  const calls = []; let reads = 0;
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["terminal"], { async invokeProvider(call) {
    calls.push(call); const request = call.request;
    if (request.operation === "create") return { sessionId: request.input.sessionId, profileId: "profile-1", revision: 1, root: "/work", shellProfile: "remote-system-default", capabilities: {} };
    if (request.operation === "read") return reads++ === 0 ? { data: Buffer.from("hello").toString("base64"), encoding: "base64" } : { data: "", encoding: "base64", exit: { code: 0, signal: null, interrupted: false } };
    return { accepted: true };
  } }, () => state);
  const pty = await runtime.invoke("terminal", "spawn", { rows: 24, cols: 80, env: {} }, context);
  const output = await new Promise((resolve) => pty.onData((bytes) => resolve(Buffer.from(bytes).toString())));
  await pty.write(Buffer.from("x")); await pty.resize({ cols: 100, rows: 30 });
  const exit = await new Promise((resolve) => pty.onExit(resolve));
  assert.equal(output, "hello"); assert.equal(exit.exitCode, 0);
  assert.deepEqual(calls.map((call) => call.request.operation).slice(0,5), ["create","read","input","resize","read"]);
});

test("provider PTY refreshes the creation request deadline for later stream operations", async () => {
  const deadlines = [];
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["terminal"], { async invokeProvider(call) {
    deadlines.push({ operation: call.request.operation, deadlineMs: call.deadlineMs });
    if (call.request.operation === "create") return { sessionId: call.request.input.sessionId };
    if (call.request.operation === "read") return { data: "", encoding: "base64", exit: { code: 0, signal: null, interrupted: false } };
    return { accepted: true };
  } }, () => state);
  const pty = await runtime.invoke("terminal", "spawn", { rows: 24, cols: 80 }, { ...context, deadline: Date.now() - 1 });
  await new Promise((resolve) => pty.onExit(resolve));
  assert.equal(deadlines[0].operation, "create");
  assert.equal(deadlines[0].deadlineMs, 1);
  assert.deepEqual(deadlines[1].operation, "read");
  assert.ok(deadlines[1].deadlineMs > 25_000);
});

test("provider PTY adapts proof-bound process polling into cwd and foreground signals", async () => {
  let remoteSessionId; let processPolls=0;
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, ["terminal", "process-observation"], { async invokeProvider(call) {
    const { capability, operation, input }=call.request;
    if(capability==="terminal"&&operation==="create"){remoteSessionId=input.sessionId;return{sessionId:remoteSessionId};}
    if(capability==="terminal"&&operation==="read")return{data:"",exit:undefined};
    if(capability==="terminal")return{accepted:true};
    if(operation==="observe")return{observationId:"process-one",protocol:"terminay-target-helper/process-v1",version:1,state:"starting"};
    if(operation==="poll"){processPolls++;return{observationId:"process-one",state:"available",cwd:"/work/sub",foregroundProcess:"codex",observedAt:Date.now()};}
    return{observationId:"process-one",stopped:true};
  } }, () => ({ ...state, environments:{[environment.id]:{...environment,declaredCapabilities:["terminal","process-observation"],availableCapabilities:["terminal","process-observation"]}} }));
  const pty=await runtime.invoke("terminal","spawn",{rows:24,cols:80},context);
  assert.equal(await pty.getCwd(),"/work/sub");
  const foreground=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("foreground callback timed out")),1000);pty.onForegroundProcess((event)=>{clearTimeout(timeout);resolve(event);});});
  assert.deepEqual(foreground,{processName:"codex",shellForeground:false});assert.ok(processPolls>=2);await pty.dispose();
});
