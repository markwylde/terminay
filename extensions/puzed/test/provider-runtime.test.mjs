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
    dependencies: { async call(request) { calls.push(structuredClone(request)); if (request.operation === "managed-binding.generate") return { bindingId: "binding-1", publicKey: "ssh-ed25519 AAAA fixture" }; if (request.operation === "managed-binding.bind") return { bindingId: "binding-1", revision: 3 }; if (request.operation === "managed-binding.verify") return { state: "ready", canonicalRoot: "/srv/project", revision: 3 }; if (request.operation === "managed-binding.service") return { forwarded: true }; throw new Error(`unexpected ${request.operation}`); } },
    profiles: { async get() { return { profileId: "profile-1", providerId: "com.puzed.platform/vm", values: { baseUrl: "https://platform.test" }, secretFields: ["apiKey"], revision: 1 }; } },
    secrets: { async withValue(_request, use) { return use(new TextEncoder().encode("secret")); } },
    sshAgent: { async listIdentities() { return []; }, async sign() { throw new Error("unused"); } },
  };
  return { definition: registrations[0].definition, runtime: registrations[0].runtime, calls, call };
}

test("Puzed exposes a create form and tests a saved profile with its vault-bound API key", async () => {
  const f = runtimeFixture();
	assert.equal(f.definition.profileForm?.title, "New Puzed provider");
	assert.equal(f.definition.profileForm?.submitLabel, "Test and save provider");
  assert.equal(f.definition.createForm?.submitLabel, "Create VM and open project");
  assert.equal(f.definition.createForm?.sections[0]?.fields.some((field) => field.id === "image-id"), true);
  const fetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ principal_type: "api_key", effective_scopes: { machines: "write", images: "read", workers: "read", networks: "read", jobs: "read", events: "read", settings: "read" }, org: { id: "org-1", slug: "home", status: "ready" } });
  };
  try {
    assert.deepEqual(await f.runtime.testProfile({ profileId: "profile-1", values: {} }, f.call), []);
  } finally {
    globalThis.fetch = fetch;
  }
  assert.equal(requests[0].url, "https://platform.test/api/v1/me");
  assert.equal(requests[0].init.headers.Authorization, "Bearer secret");
});

test("Puzed enables an image when the selected size meets its root-disk minimum", async () => {
  const f = runtimeFixture();
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/images") return Response.json({ items: [
      { id: "base", name: "Debian Base", status: "ready", cloud_init_supported: true, min_disk_bytes: 10 * 1024 ** 3 },
      { id: "desktop", name: "Debian Desktop", status: "ready", cloud_init_supported: true, min_disk_bytes: 25 * 1024 ** 3 },
    ] });
    if (path === "/api/v1/org/settings") return Response.json({ settings: { default_size_preset_id: "medium", default_size_presets: [
      { id: "medium", label: "Medium", vcpus: 2, memory_bytes: 2 * 1024 ** 3, root_disk_bytes: 20 * 1024 ** 3 },
    ] } });
    throw new Error(`unexpected request ${path}`);
  };
  try {
    const result = await f.runtime.resolveOptions({ profileId: "profile-1", sourceId: "com.puzed.platform/vm/images", values: { "size-preset": "medium" } }, f.call);
    assert.deepEqual(result.options, [
      { value: "base", label: "Debian Base" },
      { value: "desktop", label: "Debian Desktop", disabledReason: "Requires at least 25 GB of root disk." },
    ]);
  } finally {
    globalThis.fetch = fetch;
  }
});

test("Puzed loads networks only from the selected host's bridge inventory", async () => {
  const f = runtimeFixture(); const requests = []; const fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname; requests.push(path);
    if (path === "/api/v1/workers/worker-2/bridges") return Response.json({ items: [
      { id: "bridge-2", name: "br-worker-2", is_default: true, worker_id: "worker-2" },
    ] });
    throw new Error(`unexpected request ${path}`);
  };
  try {
    assert.deepEqual(
      await f.runtime.resolveOptions({ profileId: "profile-1", sourceId: "com.puzed.platform/vm/bridges", values: { "worker-id": "worker-2" } }, f.call),
      { options: [{ value: "bridge-2", label: "br-worker-2", default: true }] },
    );
    assert.deepEqual(await f.runtime.resolveOptions({ profileId: "profile-1", sourceId: "com.puzed.platform/vm/bridges", values: {} }, f.call), { options: [] });
    assert.deepEqual(requests, ["/api/v1/workers/worker-2/bridges"]);
  } finally {
    globalThis.fetch = fetch;
  }
});

test("Puzed preflights the selected host and network before generating a key or creating a VM", async () => {
  const f = runtimeFixture(); const requests = []; const fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname; requests.push(path);
    if (path === "/api/v1/org/settings") return Response.json({ settings: { default_size_presets: [{ id: "medium", label: "Medium", vcpus: 2, memory_bytes: 2 * 1024 ** 3, root_disk_bytes: 20 * 1024 ** 3 }] } });
    if (path === "/api/v1/workers/worker-1/bridges") return Response.json({ items: [{ id: "bridge-other", name: "other", is_default: true, worker_id: "worker-1" }] });
    throw new Error(`unexpected request ${path}`);
  };
  try {
    await assert.rejects(
      () => f.runtime.createEnvironment({ environmentId: "env-preflight", profileId: "profile-1", displayName: "Rejected VM", values: { "image-id": "image-1", "size-preset": "medium", "worker-id": "worker-1", "bridge-id": "bridge-stale", name: "rejected-vm" } }, f.call),
      /Puzed rejected VM creation \(HTTP 409, bridge_worker_mismatch\)\./,
    );
    assert.deepEqual(requests, ["/api/v1/org/settings", "/api/v1/workers/worker-1/bridges"]);
    assert.deepEqual(f.calls, []);
  } finally {
    globalThis.fetch = fetch;
  }
});

test("a late authoritative bridge rejection remains bounded after preflight", async () => {
  const f = runtimeFixture(); const requests = []; const fetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; requests.push({ path, init });
    if (path === "/api/v1/org/settings") return Response.json({ settings: { default_size_presets: [{ id: "medium", label: "Medium", vcpus: 2, memory_bytes: 2 * 1024 ** 3, root_disk_bytes: 20 * 1024 ** 3 }] } });
    if (path === "/api/v1/workers/worker-1/bridges") return Response.json({ items: [{ id: "bridge-1", name: "default", is_default: true, worker_id: "worker-1" }] });
    if (path === "/api/v1/machines") return Response.json({ code: "bridge_worker_mismatch" }, { status: 409 });
    throw new Error(`unexpected request ${path}`);
  };
  try {
    await assert.rejects(
      () => f.runtime.createEnvironment({ environmentId: "env-late-rejection", profileId: "profile-1", displayName: "Rejected VM", values: { "image-id": "image-1", "size-preset": "medium", "worker-id": "worker-1", "bridge-id": "bridge-1", name: "rejected-vm" } }, f.call),
      /Puzed rejected VM creation \(HTTP 409, bridge_worker_mismatch\)\./,
    );
    assert.deepEqual(f.calls.map((call) => call.operation), ["managed-binding.generate"]);
    assert.deepEqual(requests.map((request) => request.path), ["/api/v1/org/settings", "/api/v1/workers/worker-1/bridges", "/api/v1/machines"]);
  } finally {
    globalThis.fetch = fetch;
  }
});

test("Puzed exposes a bounded VM-create rejection with its HTTP status and provider code", async () => {
  const f = runtimeFixture(); const fetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/org/settings") return Response.json({ settings: { default_size_presets: [{ id: "medium", label: "Medium", vcpus: 2, memory_bytes: 2 * 1024 ** 3, root_disk_bytes: 20 * 1024 ** 3 }] } });
    if (path === "/api/v1/machines") return Response.json({ code: "host_capacity_exhausted" }, { status: 422 });
    throw new Error(`unexpected request ${path}`);
  };
  try {
    await assert.rejects(
      () => f.runtime.createEnvironment({ environmentId: "env-3", profileId: "profile-1", displayName: "Rejected VM", values: { "image-id": "image-1", "size-preset": "medium", "worker-id": "worker-1", name: "rejected-vm" } }, f.call),
      /Puzed rejected VM creation \(HTTP 422, host_capacity_exhausted\)\./,
    );
  } finally {
    globalThis.fetch = fetch;
  }
});

test("Puzed creates a composed environment only through the public SSH dependency", async () => {
  const f = runtimeFixture();
  const created = await f.runtime.createEnvironment({ environmentId: "env-1", profileId: "profile-1", displayName: "Dev VM", values: { baseUrl: "https://platform.test", machineId: "machine-1", bindingId: "binding-1", host: "192.0.2.4", username: "vms", root: "/srv/project" } }, f.call);
  assert.equal(created.state, "ready"); assert.equal(created.providerState.bindingId, "binding-1"); assert.equal(created.status.defaultRoot, "/srv/project");
  assert.deepEqual(f.calls.map((item) => item.operation), ["managed-binding.bind", "managed-binding.verify"]);
  assert.equal(f.calls.every((item) => item.providerId === "com.terminay.ssh/connection"), true);
  assert.equal(JSON.stringify(f.calls).includes("secret"), false);
});

test("Puzed requests a dedicated SSH-owned key when no retained binding exists", async () => {
  const f = runtimeFixture();
  await f.runtime.createEnvironment({ environmentId: "env-2", profileId: "profile-1", displayName: "New VM", values: { baseUrl: "https://platform.test", machineId: "machine-2", operationId: "create-machine-2", host: "192.0.2.5", username: "vms" } }, f.call);
  assert.deepEqual(f.calls.map((item) => item.operation), ["managed-binding.generate", "managed-binding.bind", "managed-binding.verify"]);
  assert.equal(JSON.stringify(f.calls).includes("private"), false);
});

test("Puzed terminal/filesystem operations stay revision-bound and forward through SSH", async () => {
  const f = runtimeFixture(); const providerState = { profileId: "profile-1", machineId: "machine-1", bindingId: "binding-1", sshRevision: 3, displayName: "Dev VM", baseUrl: "https://platform.test", managementState: "running" };
  assert.deepEqual(await f.runtime.invokeService({ environmentId: "env-1", profileId: "profile-1", providerState, capability: "filesystem", operation: "stat", projectId: "project-1", environmentRevision: 3, input: { path: "/srv/project" } }, f.call), { forwarded: true });
  assert.deepEqual(f.calls[0].payload, { bindingId: "binding-1", expectedRevision: 3, capability: "filesystem", operation: "stat", projectId: "project-1", input: { path: "/srv/project" } });
});
