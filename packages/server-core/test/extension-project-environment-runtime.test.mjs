import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionProjectEnvironmentRuntime } from "../dist/extensions/projectEnvironmentRuntime.js";

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
  await runtime.invoke("process-observation", "report", { observationId: "process-a", sessionId: "session-a", proof: "secret", version: 1, sequence: 2, cwd: "/work", foregroundProcess: "codex", observedAt: Date.now() }, context);
  assert.equal(calls.length, 2);
  await assert.rejects(runtime.invoke("filesystem-observation", "poll", { observationId: "watch-a", injected: true }, context), /unknown fields/);
  await assert.rejects(runtime.invoke("process-observation", "report", { observationId: "process-a", sessionId: "session-a", proof: "secret", version: 2, sequence: 2, cwd: "/work", observedAt: Date.now() }, context), /invalid/);
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
