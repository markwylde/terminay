import assert from "node:assert/strict";
import test from "node:test";
import { SecureCredentialStore } from "../dist/main/index.js";

const identity = {
  profileId: "remote-secure",
  serverId: "server-secure",
  origin: "https://secure.example",
  kind: "device-key",
};

function backend({ available = true, stored = new Map(), fail = false } = {}) {
  const calls = [];
  return {
    calls,
    stored,
    status: async () => {
      calls.push(["status"]);
      if (fail) throw new Error("backend failure");
      return available ? { status: "available", backend: "os" } : { status: "degraded", reason: "locked", action: "re-pair" };
    },
    read: async (key) => { calls.push(["read", key]); return stored.get(key); },
    write: async (key, value) => { calls.push(["write", key, value]); stored.set(key, value); },
    delete: async (key) => { calls.push(["delete", key]); stored.delete(key); },
  };
}

test("secure credential store round-trips through the OS backend and deletes by profile identity", async () => {
  const native = backend();
  const store = new SecureCredentialStore(native);

  assert.deepEqual(await store.status(), { status: "available", backend: "os" });
  assert.deepEqual(await store.save(identity, "protected-device-key"), { status: "available", backend: "os" });
  const loaded = await store.load(identity);
  assert.deepEqual(loaded, { status: "available", backend: "os", value: { ...identity, secret: "protected-device-key" } });
  assert.equal(native.calls.filter(([operation]) => operation === "write").length, 1);

  assert.deepEqual(await store.remove(identity), { status: "available", backend: "os" });
  assert.deepEqual(await store.load(identity), { status: "available", backend: "os" });
  assert.equal(native.stored.size, 0);
});

test("unavailable secure storage is explicit and never falls back to plaintext or silent reconnect", async () => {
  const native = backend({ available: false });
  const store = new SecureCredentialStore(native);

  const degraded = { status: "degraded", reason: "locked", action: "re-pair" };
  assert.deepEqual(await store.status(), degraded);
  assert.deepEqual(await store.save(identity, "must-not-persist"), degraded);
  assert.deepEqual(await store.load(identity), degraded);
  assert.deepEqual(await store.remove(identity), degraded);
  assert.equal(native.calls.some(([operation]) => operation !== "status"), false);
  assert.equal(native.stored.size, 0);
});

test("missing backend is a declared re-pair state, not a plaintext storage mode", async () => {
  const store = new SecureCredentialStore();
  const result = await store.save(identity, "must-not-persist");
  assert.deepEqual(result, { status: "degraded", reason: "not-configured", action: "re-pair" });
  assert.deepEqual(await store.load(identity), result);
});

test("corrupt or identity-mismatched backend records are retired and fail closed without exposing their contents", async () => {
  const native = backend();
  const store = new SecureCredentialStore(native);
  await store.save(identity, "original-secret");
  const key = [...native.stored.keys()][0];

  native.stored.set(key, JSON.stringify({ ...identity, secret: "corrupt-secret", extra: "forbidden" }));
  const corrupt = await store.load(identity);
  assert.deepEqual(corrupt, { status: "degraded", reason: "corrupt-record", action: "re-pair" });
  assert.equal(JSON.stringify(corrupt).includes("corrupt-secret"), false);
  assert.equal(native.stored.has(key), false);

  native.stored.set(key, JSON.stringify({ ...identity, origin: "https://other.example", secret: "wrong-origin-secret" }));
  const mismatched = await store.load(identity);
  assert.deepEqual(mismatched, { status: "degraded", reason: "corrupt-record", action: "re-pair" });
  assert.equal(JSON.stringify(mismatched).includes("wrong-origin-secret"), false);
  assert.equal(native.stored.has(key), false);
  assert.equal(native.calls.filter(([operation]) => operation === "delete").length, 2);
});

test("an invalid record whose secure deletion fails remains explicitly degraded", async () => {
  const native = backend();
  const store = new SecureCredentialStore(native);
  await store.save(identity, "original-secret");
  const key = [...native.stored.keys()][0];
  native.stored.set(key, JSON.stringify({ ...identity, serverId: "another-server", secret: "stale-secret" }));
  native.delete = async () => { throw new Error("keychain unavailable"); };

  const result = await store.load(identity);
  assert.deepEqual(result, { status: "degraded", reason: "backend-error", action: "re-pair" });
  assert.equal(JSON.stringify(result).includes("stale-secret"), false);
  assert.equal(native.stored.has(key), true);
});

test("backend failures degrade instead of returning native error or secret text", async () => {
  const native = backend({ fail: true });
  const store = new SecureCredentialStore(native);
  const result = await store.save(identity, "backend-secret");
  assert.deepEqual(result, { status: "degraded", reason: "backend-error", action: "re-pair" });
  assert.equal(JSON.stringify(result).includes("backend-secret"), false);
});
