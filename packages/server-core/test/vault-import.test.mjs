import test from "node:test";
import assert from "node:assert/strict";
import {
  EmbeddedSafeStorageImport,
  EmbeddedVaultImportCoordinator,
  EmbeddedVaultImportError,
  ServerVaultService,
} from "../dist/settings/index.js";

function createVault() {
  let state = "unlocked";
  const entries = new Map();
  const adapter = {
    backend: "custom",
    status: () => state,
    async unlock() { state = "unlocked"; },
    lock() { state = "locked"; },
    list: () => [...entries.values()].map((entry) => ({ ...entry })),
    async put(input) {
      if (entries.has(input.id)) throw new Error("duplicate secret");
      const value = Buffer.from(input.value);
      input.value.fill(0);
      entries.set(input.id, { id: input.id, configured: true, label: input.label, version: 1, value });
      return entries.get(input.id);
    },
    async replace(input) { return this.put(input); },
    async test(id) {
      if (!entries.has(id)) throw new Error("missing secret");
    },
    async remove(id) { return entries.delete(id); },
    async rotate() {},
    async withSecret(id, callback) { return callback(new Uint8Array(entries.get(id).value)); },
  };
  return { service: new ServerVaultService(adapter), adapter, entries, setState: (next) => { state = next; } };
}

function createSafeStorage(values, calls, options = {}) {
  const plaintextBuffers = [];
  return {
    backend: "embedded-safe-storage",
    plaintextBuffers,
    isAvailable: () => options.available !== false,
    decrypt(ciphertext) {
      calls.push(Buffer.from(ciphertext).toString("hex"));
      if (options.failOn?.(ciphertext)) throw new Error("legacy source path and plaintext must not escape");
      const value = Buffer.from(values.get(Buffer.from(ciphertext).toString("hex")) ?? "");
      plaintextBuffers.push(value);
      return value;
    },
  };
}

test("embedded safe-storage import is metadata-only, bounded, and idempotent", async () => {
  const { service } = createVault();
  const calls = [];
  const values = new Map([["01", "first-secret"], ["02", "second-secret"]]);
  const safeStorage = createSafeStorage(values, calls);
  const completed = new Set();
  const ledger = { isComplete: (sourceId) => completed.has(sourceId), markComplete: (sourceId) => { completed.add(sourceId); } };
  const coordinator = new EmbeddedVaultImportCoordinator(service, safeStorage, ledger);
  const source = { sourceId: "electron-safe-storage", entries: [
    { id: "provider.one", label: "Provider one", encryptedValue: new Uint8Array([1]) },
    { id: "provider.two", label: "Provider two", encryptedValue: new Uint8Array([2]) },
  ] };
  const imported = await coordinator.importOnce(source);
  assert.equal(imported.imported, 2);
  assert.equal(imported.skippedExisting, 0);
  assert.equal(imported.alreadyComplete, false);
  assert.equal(imported.status.entries.length, 2);
  assert.equal(JSON.stringify(imported).includes("first-secret"), false);
  assert.equal(JSON.stringify(imported).includes("second-secret"), false);
  assert.deepEqual(calls, ["01", "02"]);
  assert.ok(safeStorage.plaintextBuffers.every((value) => value.every((byte) => byte === 0)));

  const repeated = await coordinator.importOnce(source);
  assert.equal(repeated.alreadyComplete, true);
  assert.equal(repeated.imported, 0);
  assert.deepEqual(calls, ["01", "02"]);
});

test("embedded import resumes after a failed entry without replaying completed plaintext", async () => {
  const { service } = createVault();
  const calls = [];
  const values = new Map([["01", "first-secret"], ["02", "second-secret"]]);
  let fail = true;
  const safeStorage = createSafeStorage(values, calls, { failOn: (ciphertext) => fail && Buffer.from(ciphertext).toString("hex") === "02" });
  const completed = new Set();
  const ledger = { isComplete: (sourceId) => completed.has(sourceId), markComplete: (sourceId) => { completed.add(sourceId); } };
  const coordinator = new EmbeddedSafeStorageImport(service, safeStorage, ledger);
  const source = { sourceId: "electron-retry", entries: [
    { id: "provider.one", encryptedValue: new Uint8Array([1]) },
    { id: "provider.two", encryptedValue: new Uint8Array([2]) },
  ] };
  await assert.rejects(() => coordinator.importOnce(source), (error) => error instanceof EmbeddedVaultImportError && error.code === "failed");
  assert.equal(completed.has(source.sourceId), false);
  fail = false;
  const resumed = await coordinator.importOnce(source);
  assert.equal(resumed.imported, 1);
  assert.equal(resumed.skippedExisting, 1);
  assert.equal(completed.has(source.sourceId), true);
  assert.deepEqual(calls, ["01", "02", "02"]);
});

test("embedded import refuses unavailable or locked vaults before decrypting", async () => {
  const vault = createVault();
  const calls = [];
  const safeStorage = createSafeStorage(new Map([["01", "secret"]]), calls);
  const ledger = { isComplete: () => false, markComplete() {} };
  const coordinator = new EmbeddedVaultImportCoordinator(vault.service, safeStorage, ledger, { maxEntries: 1 });
  vault.setState("locked");
  await assert.rejects(() => coordinator.importOnce({ sourceId: "locked", entries: [{ id: "secret", encryptedValue: new Uint8Array([1]) }] }), (error) => error.code === "locked");
  assert.deepEqual(calls, []);
  vault.setState("unlocked");
  const unavailable = createSafeStorage(new Map(), calls, { available: false });
  const unavailableCoordinator = new EmbeddedVaultImportCoordinator(vault.service, unavailable, ledger);
  await assert.rejects(() => unavailableCoordinator.importOnce({ sourceId: "unavailable", entries: [] }), (error) => error.code === "unavailable");
  assert.deepEqual(calls, []);
  assert.throws(() => coordinator.importOnce({ sourceId: "bad", entries: Array.from({ length: 2 }, (_, index) => ({ id: `id-${index}`, encryptedValue: new Uint8Array([1]) })) }), /limit|invalid/);
});
