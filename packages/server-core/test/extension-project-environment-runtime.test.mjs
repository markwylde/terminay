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
