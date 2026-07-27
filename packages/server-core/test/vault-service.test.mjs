import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_VAULT_UNLOCK_BYTES,
  MAX_VAULT_SECRET_BYTES,
  ServerVaultService,
  VaultServiceError,
} from "../dist/settings/index.js";

function createAdapter() {
  let state = "locked";
  let entries = new Map();
  const calls = [];
  return {
    backend: "custom",
    calls,
    status: () => state,
    async unlock(request) {
      calls.push(["unlock", request.secret.byteLength]);
      state = "unlocked";
      request.secret.fill(0);
    },
    lock() {
      calls.push(["lock"]);
      state = "locked";
    },
    list: () => [...entries.values()].map((entry) => ({ ...entry })),
    async put(input) {
      if (state !== "unlocked") throw new Error("vault is locked");
      if (entries.has(input.id)) throw new Error("duplicate secret");
      calls.push(["put", input.id, input.value.toString()]);
      const reference = { id: input.id, configured: true, label: input.label, version: 1 };
      entries.set(input.id, reference);
      input.value.fill(0);
      return reference;
    },
    async replace(input) {
      if (state !== "unlocked") throw new Error("vault is locked");
      if (!entries.has(input.id)) throw new Error("missing secret");
      calls.push(["replace", input.id, input.value.toString()]);
      const prior = entries.get(input.id);
      const reference = { id: input.id, configured: true, label: input.label ?? prior.label, version: prior.version + 1 };
      entries.set(input.id, reference);
      input.value.fill(0);
      return reference;
    },
    async test(id) {
      if (state !== "unlocked") throw new Error("vault is locked");
      if (!entries.has(id)) throw new Error("missing secret");
    },
    async remove(id) {
      if (state !== "unlocked") throw new Error("vault is locked");
      calls.push(["remove", id]);
      return entries.delete(id);
    },
    async rotate() {
      if (state !== "unlocked") throw new Error("vault is locked");
      calls.push(["rotate"]);
    },
    async withSecret(id, callback) {
      if (state !== "unlocked") throw new Error("vault is locked");
      if (!entries.has(id)) throw new Error("missing secret");
      const value = new Uint8Array(Buffer.from("vault-plaintext-sentinel"));
      try {
        return await callback(value);
      } finally {
        value.fill(0);
      }
    },
  };
}

test("vault commands expose metadata only and revisioned mutations", async () => {
  const adapter = createAdapter();
  const service = new ServerVaultService(adapter);
  assert.deepEqual(service.status(), { state: "locked", backend: "custom", revision: 0, entries: [] });

  const unlockSecret = new Uint8Array(Buffer.from("unlock-passphrase"));
  const unlocked = await service.unlock({ secret: unlockSecret });
  assert.equal(unlockSecret.every((byte) => byte === 0), true);
  assert.equal(unlocked.state, "unlocked");
  assert.equal(service.revision, 1);

  const plaintext = new Uint8Array(Buffer.from("vault-plaintext-sentinel"));
  const put = await service.put({ id: "provider.apiKey", label: "Provider", value: plaintext });
  assert.equal(plaintext.every((byte) => byte === 0), false, "caller-owned input is not cleared by the façade");
  assert.deepEqual(put.reference, { id: "provider.apiKey", configured: true, label: "Provider", version: 1 });
  assert.equal(JSON.stringify(put).includes("vault-plaintext-sentinel"), false);
  assert.equal(service.status().entries[0].configured, true);
  assert.equal(service.revision, 2);

  const replacement = await service.replace({ id: "provider.apiKey", value: new Uint8Array([1, 2, 3]) });
  assert.equal(replacement.reference.version, 2);
  assert.equal(service.revision, 3);
  assert.deepEqual(await service.test("provider.apiKey"), { ok: true, status: service.status() });
  const removed = await service.remove("provider.apiKey");
  assert.equal(removed.deleted, true);
  assert.equal(service.status().entries.length, 0);
  assert.equal(service.revision, 4);
  await service.rotate();
  assert.equal(adapter.calls.at(-1)[0], "rotate");
  const restarted = await service.restartLock();
  assert.equal(restarted.state, "locked");
  assert.equal(service.revision, 6);
});

test("locked and unavailable states do not leak adapter errors or secret values", async () => {
  const adapter = createAdapter();
  const service = new ServerVaultService(adapter);
  const result = await service.test("missing");
  assert.deepEqual(result, { ok: false, status: service.status(), code: "locked" });

  await assert.rejects(() => service.put({ id: "bad id", value: new Uint8Array([1]) }), /id is invalid/);
  await assert.rejects(() => service.put({ id: "large", value: new Uint8Array(MAX_VAULT_SECRET_BYTES + 1) }), /exceeds/);
  await assert.rejects(() => service.unlock({ secret: new Uint8Array(MAX_VAULT_UNLOCK_BYTES + 1) }), /exceeds/);

  adapter.status = () => "unavailable";
  const unavailable = await service.test("missing");
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, "unavailable");
  assert.equal(JSON.stringify(unavailable).includes("vault-plaintext-sentinel"), false);
});

test("withSecret scopes bytes to server callback and clears the scoped copy", async () => {
  const adapter = createAdapter();
  const service = new ServerVaultService(adapter);
  await service.unlock({ secret: new Uint8Array(Buffer.from("unlock-passphrase")) });
  await service.put({ id: "provider.apiKey", value: new Uint8Array([1]) });
  let observed = "";
  await service.withSecret("provider.apiKey", (secret) => {
    observed = Buffer.from(secret).toString();
    secret.fill(0);
  });
  assert.equal(observed, "vault-plaintext-sentinel");
  assert.equal(JSON.stringify(service.status()).includes("vault-plaintext-sentinel"), false);
});

test("vault lifecycle errors are audit-safe and restart lock fences secret reads", async () => {
  const adapter = createAdapter();
  const service = new ServerVaultService(adapter);
  await service.unlock({ secret: new Uint8Array(Buffer.from("unlock-passphrase")) });
  await service.put({ id: "provider.apiKey", value: new Uint8Array([1]) });

  adapter.put = async (input) => {
    input.value.fill(0);
    throw new Error("vault-plaintext-sentinel /private/source/path");
  };
  await assert.rejects(
    () => service.put({ id: "provider.other", value: new Uint8Array([2]) }),
    (error) => error instanceof VaultServiceError && error.code === "failed" && !String(error).includes("vault-plaintext-sentinel") && !String(error).includes("private/source"),
  );

  adapter.withSecret = async () => { throw new Error("vault-plaintext-sentinel"); };
  await assert.rejects(
    () => service.withSecret("provider.apiKey", () => undefined),
    (error) => error instanceof VaultServiceError && error.code === "failed" && !String(error).includes("vault-plaintext-sentinel"),
  );

  await service.restartLock();
  await assert.rejects(() => service.withSecret("provider.apiKey", () => undefined), /vault is locked/);
  const diagnostics = service.status();
  assert.equal(diagnostics.state, "locked");
  assert.equal(JSON.stringify(diagnostics).includes("vault-plaintext-sentinel"), false);
});
