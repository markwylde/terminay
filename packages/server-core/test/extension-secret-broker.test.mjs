import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_SECRET_RESOLVE_PERMISSION,
  ExtensionSecretBroker,
  ExtensionSecretBrokerError,
  HeadlessPassphraseVaultAdapter,
  ServerRuntime,
  ServerVaultService,
  createServerVaultComposition,
} from "../dist/index.js";

const permission = () => new Set([EXTENSION_SECRET_RESOLVE_PERMISSION]);
const principal = (extensionId, permissions = permission()) => ({ extensionId, permissions, sessionId: "host-session" });
const binding = Object.freeze({ extensionId: "terminay-plugin-ssh", profileId: "prod", fieldId: "privateKey", secretId: "extensions.ssh.prod.privateKey" });

class MemoryStorage {
  serialized;
  async read() { return this.serialized; }
  async write(value) { this.serialized = value; }
}

async function headlessVault() {
  const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage: new MemoryStorage() });
  const vault = new ServerVaultService(adapter);
  await vault.unlock({ secret: new TextEncoder().encode("headless-passphrase") });
  await vault.put({ id: binding.secretId, value: new TextEncoder().encode("private-key-sentinel") });
  return vault;
}

function embeddedVault() {
  let state = "locked";
  const values = new Map();
  return new ServerVaultService({
    backend: "embedded-safe-storage",
    status: () => state,
    unlock: async ({ secret }) => { state = "unlocked"; secret.fill(0); },
    lock: () => { state = "locked"; },
    list: () => [...values.keys()].map((id) => ({ id, configured: true })),
    put: async ({ id, value }) => { values.set(id, new Uint8Array(value)); return { id, configured: true }; },
    replace: async ({ id, value }) => { values.set(id, new Uint8Array(value)); return { id, configured: true }; },
    test: async (id) => { if (!values.has(id)) throw Object.assign(new Error("missing"), { code: "missing" }); },
    remove: async (id) => values.delete(id),
    rotate: async () => undefined,
    withSecret: async (id, callback) => {
      if (state !== "unlocked") throw Object.assign(new Error("locked"), { code: "locked" });
      const stored = values.get(id);
      if (!stored) throw Object.assign(new Error("missing"), { code: "missing" });
      const copy = new Uint8Array(stored);
      try { return await callback(copy); } finally { copy.fill(0); }
    },
  });
}

test("broker resolves only the exact extension/profile/field and clears callback bytes", async () => {
  const vault = await headlessVault();
  const authorizations = [];
  const broker = new ExtensionSecretBroker(vault, [binding], {
    authorize: (actor, owned) => { authorizations.push([actor.extensionId, owned.profileId, owned.fieldId]); return true; },
  });
  let observed;
  const result = await broker.withSecret(principal(binding.extensionId), { profileId: binding.profileId, fieldId: binding.fieldId }, (secret) => {
    observed = secret;
    return new TextDecoder().decode(secret);
  });
  assert.equal(result, "private-key-sentinel");
  assert.deepEqual([...observed], new Array(observed.length).fill(0));
  assert.deepEqual(authorizations, [[binding.extensionId, binding.profileId, binding.fieldId]]);
});

test("broker denies absent permission, cross-extension, cross-profile, and authorizer rejection", async () => {
  const vault = await headlessVault();
  const broker = new ExtensionSecretBroker(vault, [binding], { authorize: (_actor, owned) => owned.fieldId !== "denied" });
  const attempts = [
    [principal(binding.extensionId, new Set()), { profileId: binding.profileId, fieldId: binding.fieldId }],
    [principal("terminay-plugin-puzed"), { profileId: binding.profileId, fieldId: binding.fieldId }],
    [principal(binding.extensionId), { profileId: "another", fieldId: binding.fieldId }],
  ];
  for (const [actor, request] of attempts) {
    await assert.rejects(broker.withSecret(actor, request, () => undefined), (error) => error instanceof ExtensionSecretBrokerError && error.code === "denied");
  }
  broker.replaceBindings([{ ...binding, fieldId: "denied" }]);
  await assert.rejects(broker.withSecret(principal(binding.extensionId), { profileId: binding.profileId, fieldId: "denied" }, () => undefined), (error) => error instanceof ExtensionSecretBrokerError && error.code === "denied");
});

test("broker clears its copy when a consumer throws and redacts vault failures", async () => {
  const vault = await headlessVault();
  const broker = new ExtensionSecretBroker(vault, [binding]);
  let observed;
  await assert.rejects(broker.withSecret(principal(binding.extensionId), { profileId: binding.profileId, fieldId: binding.fieldId }, (secret) => {
    observed = secret;
    throw new Error("consumer failed");
  }), (error) => error instanceof ExtensionSecretBrokerError && error.code === "failed" && !String(error).includes("private-key-sentinel"));
  assert.deepEqual([...observed], new Array(observed.length).fill(0));
  await vault.lock();
  await assert.rejects(broker.withSecret(principal(binding.extensionId), { profileId: binding.profileId, fieldId: binding.fieldId }, () => undefined), (error) => error instanceof ExtensionSecretBrokerError && error.code === "locked");
});

test("embedded and standalone runtimes expose the same scoped broker contract", async () => {
  for (const runtimeMode of ["embedded", "standalone"]) {
    const vault = runtimeMode === "embedded" ? embeddedVault() : await headlessVault();
    if (runtimeMode === "embedded") {
      await vault.unlock({ secret: new TextEncoder().encode("os-protector") });
      await vault.put({ id: binding.secretId, value: new TextEncoder().encode("private-key-sentinel") });
    }
    const extensionSecrets = new ExtensionSecretBroker(vault, [binding]);
    const runtime = new ServerRuntime({ serverId: `server-${runtimeMode}`, serverVersion: "1.0.0", dataRoot: `/tmp/${runtimeMode}`, runtimeMode, services: { vault, extensionSecrets } });
    assert.equal(runtime.services.extensionSecrets, extensionSecrets);
    assert.equal(await runtime.services.extensionSecrets.withSecret(principal(binding.extensionId), { profileId: binding.profileId, fieldId: binding.fieldId }, (bytes) => new TextDecoder().decode(bytes)), "private-key-sentinel");
    await runtime.stop();
    assert.equal(vault.status().state, "locked");
  }
});

test("common composition zeroizes unlock input and supplies the broker for any adapter backend", async () => {
  let state = "locked";
  const adapter = {
    backend: "embedded-safe-storage",
    status: () => state,
    unlock: async ({ secret }) => { state = "unlocked"; secret.fill(0); },
    lock: () => { state = "locked"; },
    list: () => [],
    put: async ({ id }) => ({ id, configured: true }),
    replace: async ({ id }) => ({ id, configured: true }),
    test: async () => undefined,
    remove: async () => false,
    rotate: async () => undefined,
    withSecret: async (_id, callback) => callback(new Uint8Array([1])),
  };
  const composition = createServerVaultComposition(adapter, { bindings: [binding] });
  const unlock = new TextEncoder().encode("embedded-protector");
  await composition.unlock({ secret: unlock });
  assert.equal(unlock.every((byte) => byte === 0), true);
  assert.equal(composition.status().state, "unlocked");
  assert.equal(composition.extensionSecrets instanceof ExtensionSecretBroker, true);
});

test("binding replacement is atomic and rejects collisions", async () => {
  const broker = new ExtensionSecretBroker(await headlessVault(), [binding]);
  assert.throws(() => broker.replaceBindings([binding, { ...binding, secretId: "another.secret" }]), /duplicate/);
  assert.equal(await broker.withSecret(principal(binding.extensionId), { profileId: binding.profileId, fieldId: binding.fieldId }, (bytes) => new TextDecoder().decode(bytes)), "private-key-sentinel");
});

test("runtime startup failure and shutdown both fence an unlocked vault", async () => {
  for (const failStartup of [true, false]) {
    const vault = await headlessVault();
    const runtime = new ServerRuntime({
      serverId: failStartup ? "server-failed-start" : "server-clean-stop",
      serverVersion: "1.0.0",
      dataRoot: "/tmp/vault-lifecycle",
      runtimeMode: "standalone",
      services: { vault },
    }, failStartup ? { startServices: () => { throw new Error("startup failed"); } } : {});
    if (failStartup) await assert.rejects(runtime.start(), /startup failed/);
    else { await runtime.start(); await runtime.stop(); }
    assert.equal(vault.status().state, "locked");
  }
});
