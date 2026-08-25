import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_LIMITS,
  createProviderDependencyTargetHarness,
  createProviderVaultHarness,
  validateProviderDependencyTargetContext,
  validateProviderVaultPutRequest,
  validateProviderVaultRemoveRequest,
  validateProviderVaultWithSecretRequest,
} from "../dist/index.js";

test("target context has only its vault broker and preserves typed cancellation", async () => {
  const cancelled = { aborted: true, throwIfAborted() { throw new Error("cancelled"); } };
  const harness = createProviderDependencyTargetHarness({
    async call(_request, context) {
      assert.equal(typeof context.vault.put, "function");
      assert.equal("profiles" in context, false);
      assert.equal("secrets" in context, false);
      assert.equal("sshAgent" in context, false);
      context.signal.throwIfAborted();
      return null;
    },
  });
  const request = { operation: "resource.read", payload: null, caller: { extensionId: "dev.terminay.caller", providerId: "dev.terminay.caller/source" } };
  await assert.rejects(() => harness.call(request, { signal: cancelled }), /cancelled/);
});

test("target vault is atomic, opaque, generic, and zeroizes callback copies", async () => {
  const vault = createProviderVaultHarness();
  assert.deepEqual(Object.keys(vault).sort(), ["put", "remove", "withSecret"]);
  const source = new TextEncoder().encode("only-for-fixture-vault");
  const put = await vault.put({ bindingKey: "connection.primary", purpose: "ssh.authentication", value: source, idempotencyKey: "put-1" });
  assert.match(put.binding.bindingRef, /^[A-Za-z0-9_-]{16,}$/);
  const localObject = { connected: true };
  let retainedCopy;
  const value = await vault.withSecret({ binding: put.binding, purpose: "ssh.authentication" }, async (copy) => { retainedCopy = copy; return localObject; });
  assert.equal(value, localObject, "arbitrary callback results stay local to the child");
  assert.deepEqual([...retainedCopy], Array(retainedCopy.byteLength).fill(0), "the child copy is zeroized after its callback");
  await assert.rejects(() => vault.withSecret({ binding: put.binding, purpose: "other-purpose" }, () => null), /Vault binding unavailable/);
  await assert.rejects(() => vault.withSecret({ binding: { bindingRef: "foreign_binding_ref_000000000000" }, purpose: "ssh.authentication" }, () => null), /Vault binding unavailable/);
});

test("target vault pending removal denies new uses and cleans up after an active callback", async () => {
  const vault = createProviderVaultHarness();
  const { binding, revision } = await vault.put({ bindingKey: "connection.pending", purpose: "ssh.authentication", value: new Uint8Array([1, 2, 3]), idempotencyKey: "put-1" });
  let release;
  const active = vault.withSecret({ binding, purpose: "ssh.authentication" }, () => new Promise((resolve) => { release = resolve; }));
  assert.deepEqual(await vault.remove({ binding, idempotencyKey: "remove-1", expectedRevision: revision }), { state: "pending" });
  await assert.rejects(() => vault.withSecret({ binding, purpose: "ssh.authentication" }, () => null), /Vault binding unavailable/);
  release(undefined);
  await active;
  await assert.rejects(() => vault.withSecret({ binding, purpose: "ssh.authentication" }, () => null), /Vault binding unavailable/);
});

test("target context and vault DTO validators reject malformed or unbounded public input", () => {
  const timing = { deadlineAt: "2030-01-01T00:00:00.000Z", signal: { aborted: false, throwIfAborted() {} }, vault: { unexpected: true } };
  assert.equal(validateProviderDependencyTargetContext(timing).ok, true, "the runtime vault is not serialized or inspected");
  assert.equal(validateProviderDependencyTargetContext({ ...timing, signal: { aborted: false } }).ok, false);
  assert.equal(validateProviderVaultPutRequest({ bindingKey: "connection.primary", purpose: "ssh.authentication", value: new Uint8Array([1]), idempotencyKey: "put-1" }).ok, true);
  assert.equal(validateProviderVaultWithSecretRequest({ binding: { bindingRef: "fixture_vault_ref_0000000000000001" }, purpose: "ssh.authentication" }).ok, true);
  assert.equal(validateProviderVaultRemoveRequest({ binding: { bindingRef: "fixture_vault_ref_0000000000000001" }, idempotencyKey: "remove-1" }).ok, true);
  for (const [name, result] of [
    ["unbounded binding key", validateProviderVaultPutRequest({ bindingKey: "x".repeat(257), purpose: "ssh.authentication", value: new Uint8Array(), idempotencyKey: "put-1" })],
    ["unsafe purpose", validateProviderVaultPutRequest({ bindingKey: "connection.primary", purpose: "ssh/authentication", value: new Uint8Array(), idempotencyKey: "put-1" })],
    ["oversized secret", validateProviderVaultPutRequest({ bindingKey: "connection.primary", purpose: "ssh.authentication", value: new Uint8Array(EXTENSION_LIMITS.providerVaultSecretBytes + 1), idempotencyKey: "put-1" })],
    ["forged binding shape", validateProviderVaultWithSecretRequest({ binding: { bindingRef: "too-short", vaultPath: "/private/secret" }, purpose: "ssh.authentication" })],
    ["unknown remove field", validateProviderVaultRemoveRequest({ binding: { bindingRef: "fixture_vault_ref_0000000000000001" }, idempotencyKey: "remove-1", list: true })],
  ]) {
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});
