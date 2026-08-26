import assert from "node:assert/strict";
import test from "node:test";
import { consumeEventStream, missingRequiredScopes, normalizeBaseUrl, PuzedApiError, PuzedClient, PuzedEventStreamRegistry, PuzedProvider, toInventoryItem, validateMe } from "../dist/index.js";

const machine = (overrides = {}) => ({
  id: "machine-1", name: "dev", status: "running", state_stale: false,
  tags: ["system:Terminay"], resource_version: 7, worker_id: "worker-1",
  vcpus: 2, memory_bytes: 2_000_000_000, firmware: "uefi",
  guest_agent: true, guest_login_mode: "ssh_key_only", guest_password_available: false,
  routing_slug: "dev", serial_enabled: true, video_model: "virtio", vnc_enabled: false,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});
const secret = (value = "secret") => ({ withApiKey: async (use) => use(new TextEncoder().encode(value)) });

test("profile URL normalization rejects unsafe forms", () => {
  assert.equal(normalizeBaseUrl("https://platform.example.test///").toString(), "https://platform.example.test/");
  assert.equal(normalizeBaseUrl("http://localhost:8080").origin, "http://localhost:8080");
  for (const url of ["http://platform.test", "https://user:pass@platform.test", "https://platform.test?q=x", "https://platform.test/#x"])
    assert.throws(() => normalizeBaseUrl(url));
});

test("profile validation requires effective scopes and ready organization", () => {
  const effective_scopes = { machines: "write", images: "read", workers: "read", networks: "write", jobs: "read", events: "read", settings: "read" };
  assert.deepEqual(missingRequiredScopes(effective_scopes), []);
  const result = validateMe({ principal_type: "api_key", effective_scopes, org: { id: "org-1", slug: "home", status: "ready" } });
  assert.equal(result.canCreate, true); assert.equal(result.mode, "full");
  assert.deepEqual(result.missingScopes, []);
  const degraded = validateMe({ principal_type: "api_key", effective_scopes: { ...effective_scopes, settings: undefined }, org: { id: "org-1", slug: "home", status: "ready" } });
  assert.equal(degraded.mode, "management-only"); assert.equal(degraded.canCreate, false); assert.match(degraded.degradedReason, /settings:read/);
  assert.deepEqual(missingRequiredScopes({ machines: "read" }), ["machines:write", "images:read", "workers:read", "networks:read", "jobs:read", "events:read"]);
});

test("client uses exact origin, bearer auth, exact tag filter, and pagination", async () => {
  const seen = [];
  const client = new PuzedClient("https://platform.test", secret("super-secret"), { fetch: async (url, init) => {
    seen.push({ url: String(url), init });
    const cursor = new URL(url).searchParams.get("cursor");
    return Response.json(cursor ? { items: [machine({ id: "m2" })] } : { items: [machine(), machine({ id: "excluded", tags: ["other"] })], next_cursor: "next" });
  }});
  assert.deepEqual((await client.listAllTerminayMachines()).map((item) => item.id), ["machine-1", "m2"]);
  assert.equal(seen.length, 2);
  for (const call of seen) {
    const url = new URL(call.url);
    assert.equal(url.origin, "https://platform.test");
    assert.equal(url.searchParams.get("tags"), "system:Terminay");
    assert.equal(call.init.headers.Authorization, "Bearer super-secret");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.url.includes("super-secret"), false);
  }
});

test("API-key broker bytes are cleared after each request", async () => {
  const bytes = new TextEncoder().encode("super-secret");
  const client = new PuzedClient("https://platform.test", { withApiKey: (use) => use(bytes) }, { fetch: async () => Response.json({ items: [] }) });
  await client.listTerminayMachines();
  assert.deepEqual([...bytes], new Array(bytes.length).fill(0));
});

test("redirects are rejected without following or forwarding authorization", async () => {
  let calls = 0;
  const client = new PuzedClient("https://platform.test", secret(), { fetch: async () => { calls++; return new Response(null, { status: 302, headers: { Location: "https://evil.test/" } }); } });
  await assert.rejects(client.validateProfile(), (error) => error instanceof PuzedApiError && error.code === "redirect_rejected");
  assert.equal(calls, 1);
});

test("audit emits only bounded safe request facts", async () => {
  const audit = [];
  const client = new PuzedClient("https://platform.test", secret(), { audit: (event) => audit.push(event), fetch: async () => Response.json({ org: { id: "org", slug: "home", status: "ready" }, principal_type: "api_key", effective_scopes: {} }) });
  await client.validateProfile();
  assert.deepEqual(audit, [{ action: "GET /api/v1/me", result: "succeeded", status: 200 }]);
  assert.equal(JSON.stringify(audit).includes("secret"), false);
});

test("lifecycle calls carry idempotency and revision controls", async () => {
  const requests = [];
  const client = new PuzedClient("https://platform.test", secret(), { fetch: async (url, init) => {
    requests.push({ url: String(url), init }); return Response.json({ machine: machine(), job_id: "job-1" }, { status: 202 });
  }});
  await client.powerMachine("machine-1", "resume", "power-key");
  await client.deleteMachine("machine-1", 7, "delete-key", { disk_disposition: "keep" });
  assert.equal(requests[0].init.headers["Idempotency-Key"], "power-key");
  assert.deepEqual(JSON.parse(requests[0].init.body), { state: "resume" });
  assert.equal(requests[1].init.headers["If-Match"], "7");
  assert.equal(requests[1].init.headers["Idempotency-Key"], "delete-key");
  assert.deepEqual(JSON.parse(requests[1].init.body), { disk_disposition: "keep" });
});

test("VM creation sends the dedicated public key, exact Terminay tag, and durable idempotency key", async () => {
  const requests = [];
  const client = new PuzedClient("https://platform.test", secret(), { fetch: async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ machine: machine({ id: "created-vm" }), job_id: "job-1" }, { status: 202 });
  }});
  const created = await client.createMachine({ name: "brave-otter", worker_id: "worker-1", vcpus: 2, memory_bytes: 2_000_000_000, root_disk_bytes: 20_000_000_000, source: { type: "image", image_id: "image-1" }, guest_login_mode: "ssh_key_only", ssh_keys: ["ssh-ed25519 AAAA managed"], tags: ["system:Terminay"], start: true }, "create-key");
  assert.equal(created.machine.id, "created-vm");
  assert.equal(requests[0].url, "https://platform.test/api/v1/machines");
  assert.equal(requests[0].init.headers["Idempotency-Key"], "create-key");
  assert.deepEqual(JSON.parse(requests[0].init.body), { name: "brave-otter", worker_id: "worker-1", vcpus: 2, memory_bytes: 2_000_000_000, root_disk_bytes: 20_000_000_000, source: { type: "image", image_id: "image-1" }, guest_login_mode: "ssh_key_only", ssh_keys: ["ssh-ed25519 AAAA managed"], tags: ["system:Terminay"], start: true });
});

test("worker-scoped bridge discovery never falls back to the organization bridge list", async () => {
  const requests = [];
  const client = new PuzedClient("https://platform.test", secret(), { fetch: async (url) => {
    requests.push(String(url));
    return Response.json({ items: [{ id: "bridge-1", name: "br0", is_default: true, worker_id: "worker-1" }] });
  }});
  const result = await client.listWorkerBridges("worker-1");
  assert.equal(result.items?.[0]?.id, "bridge-1");
  assert.equal(requests[0], "https://platform.test/api/v1/workers/worker-1/bridges?page_size=100");
});

test("worker-scoped compatibility discovery follows all pages", async () => {
  const requests = [];
  const client = new PuzedClient("https://platform.test", secret(), { fetch: async (url) => {
    const value = new URL(String(url)); requests.push(value.searchParams.get("cursor"));
    return Response.json(value.searchParams.has("cursor")
      ? { items: [{ id: "bridge-2", name: "br1", is_default: false, worker_id: "worker-1" }] }
      : { items: [{ id: "bridge-1", name: "br0", is_default: true, worker_id: "worker-1" }], next_cursor: "next" });
  }});
  assert.deepEqual((await client.listAllWorkerBridges("worker-1")).map((bridge) => bridge.id), ["bridge-1", "bridge-2"]);
  assert.deepEqual(requests, [null, "next"]);
});

test("inventory excludes untagged VMs and requires a retained SSH binding", () => {
  const base = new URL("https://platform.test");
  assert.throws(() => toInventoryItem(machine({ tags: ["production"] }), "profile-1", base, undefined, "10.0.0.2"));
  const keyless = toInventoryItem(machine(), "profile-1", base, { platformProfileId: "profile-1", machineId: "machine-1", sshUsername: "vms" }, "10.0.0.2");
  assert.equal(keyless.openable, false);
  assert.match(keyless.disabledReason, /SSH binding/);
  const bound = toInventoryItem(machine(), "profile-1", base, { platformProfileId: "profile-1", machineId: "machine-1", sshUsername: "vms", sshBindingId: "binding-ref", defaultRoot: "/work" }, "10.0.0.2");
  assert.equal(bound.openable, true);
  assert.deepEqual(bound.ssh, { providerId: "com.terminay.ssh/connection", bindingId: "binding-ref", logicalHostIdentity: "puzed:profile-1:machine-1", host: "10.0.0.2", port: 22, username: "vms", defaultRoot: "/work" });
  assert.equal(bound.openInPuzedUrl, "https://platform.test/vms/machine-1");
});

test("provider project close has no implicit Puzed lifecycle operation", async () => {
  let lifecycleCalls = 0;
  const client = { baseUrl: new URL("https://platform.test"), listAllTerminayMachines: async () => [machine()], powerMachine: async () => { lifecycleCalls++; } };
  const provider = new PuzedProvider("profile-1", client, { get: async () => ({ platformProfileId: "profile-1", machineId: "machine-1", sshUsername: "vms", sshBindingId: "binding" }) }, { resolve: async () => "10.0.0.2" });
  assert.equal((await provider.inventory())[0].openable, true);
  assert.equal("close" in provider, false);
  assert.equal(lifecycleCalls, 0);
});

test("SSE parser emits payload-free invalidations and persists cursors after delivery", async () => {
  const values = []; const cursors = [];
  const response = new Response("event: resync\ndata: {}\n\nevent: ready\ndata: {}\n\nid: 42\ndata: {\"type\":\"machine\",\"method\":\"updated\",\"id\":\"machine-1\"}\n\n");
  await consumeEventStream(response, async (value) => values.push(value), async (cursor) => cursors.push(cursor));
  assert.deepEqual(values.map((value) => value.kind), ["resync", "ready", "entity"]);
  assert.deepEqual(values[2].event, { type: "machine", method: "updated", id: "machine-1" });
  assert.deepEqual(cursors, ["42"]);
});

test("event registry shares one stream for a profile and organization", async () => {
  const registry = new PuzedEventStreamRegistry(); let runs = 0; let release;
  const subscription = { run: async () => { runs++; await new Promise((resolve) => { release = resolve; }); } };
  const first = registry.acquire("profile", "org", () => subscription);
  const second = registry.acquire("profile", "org", () => subscription);
  assert.equal(first.completion, second.completion); assert.equal(runs, 1); assert.equal(registry.active("profile", "org"), true);
  first.release(); assert.equal(registry.active("profile", "org"), true);
  second.release(); release(); await first.completion; assert.equal(registry.active("profile", "org"), false);
});
