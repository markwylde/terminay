import assert from "node:assert/strict";
import test from "node:test";
import { activate } from "../dist/index.js";

function runtimeFixture() {
  const registrations = [];
  activate({ extensionId: "com.puzed.platform", apiVersion: "1.1.0", paths: { configuration: "/tmp/config", data: "/tmp/data", cache: "/tmp/cache" }, registerProjectEnvironmentProvider(value) { registrations.push(value); } });
  const calls = [];
  const call = {
    deadlineAt: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: "open-machine", expectedRevision: undefined,
    signal: { aborted: false, throwIfAborted() {} },
    dependencies: { async call(request) { calls.push(structuredClone(request)); if (request.operation === "managed-binding.bind") return { bindingId: "binding-1", revision: 3 }; if (request.operation === "managed-binding.verify") return { state: "ready", canonicalRoot: "/srv/project", revision: 3 }; if (request.operation === "managed-binding.service") return { forwarded: true }; throw new Error(`unexpected ${request.operation}`); } },
    profiles: { async get() { return { profileId: "profile-1", providerId: "com.puzed.platform/vm", values: { baseUrl: "https://platform.test" }, secretFields: ["apiKey"], revision: 1 }; } },
    secrets: { async withValue(_request, use) { return use(new TextEncoder().encode("secret")); } },
    sshAgent: { async listIdentities() { return []; }, async sign() { throw new Error("unused"); } },
  };
  return { runtime: registrations[0].runtime, calls, call };
}

test("Puzed creates a composed environment only through the public SSH dependency", async () => {
  const f = runtimeFixture();
  const created = await f.runtime.createEnvironment({ environmentId: "env-1", profileId: "profile-1", displayName: "Dev VM", values: { baseUrl: "https://platform.test", machineId: "machine-1", bindingId: "binding-1", host: "192.0.2.4", username: "vms", root: "/srv/project" } }, f.call);
  assert.equal(created.state, "ready"); assert.equal(created.providerState.bindingId, "binding-1"); assert.equal(created.status.defaultRoot, "/srv/project");
  assert.deepEqual(f.calls.map((item) => item.operation), ["managed-binding.bind", "managed-binding.verify"]);
  assert.equal(f.calls.every((item) => item.providerId === "com.terminay.ssh/connection"), true);
  assert.equal(JSON.stringify(f.calls).includes("secret"), false);
});

test("Puzed terminal/filesystem operations stay revision-bound and forward through SSH", async () => {
  const f = runtimeFixture(); const providerState = { profileId: "profile-1", machineId: "machine-1", bindingId: "binding-1", sshRevision: 3, displayName: "Dev VM", baseUrl: "https://platform.test", managementState: "running" };
  assert.deepEqual(await f.runtime.invokeService({ environmentId: "env-1", profileId: "profile-1", providerState, capability: "filesystem", operation: "stat", projectId: "project-1", environmentRevision: 3, input: { path: "/srv/project" } }, f.call), { forwarded: true });
  assert.deepEqual(f.calls[0].payload, { bindingId: "binding-1", expectedRevision: 3, capability: "filesystem", operation: "stat", projectId: "project-1", input: { path: "/srv/project" } });
});
