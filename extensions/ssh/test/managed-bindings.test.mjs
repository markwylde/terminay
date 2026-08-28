import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedBindingService, ProfileStore } from "../dist/index.js";
import ssh2 from "@electerm/ssh2";

const { utils: sshUtils } = ssh2;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-managed-ssh-"));
  const profiles = await new ProfileStore(join(root, "config"), join(root, "data")).load();
  const serviceCalls = [];
  const service = await new ManagedBindingService(join(root, "data"), profiles, {
    async testProfile() { return []; }, async resolveOptions() { return { options: [] }; },
    async createEnvironment() { throw new Error("unused"); }, async resumeOperation() { throw new Error("unused"); },
    async getStatus() { return { state: "available", revision: 1 }; }, async invokeAction() { throw new Error("unused"); },
    async invokeService(request) {
      serviceCalls.push(structuredClone(request));
      if (request.capability === "filesystem" && request.operation === "resolveRoot") return { root: "/home/vms" };
      return { root: request.providerState.root };
    },
  }).load();
  const values = new Map(); let puts = 0;
  const context = {
    deadlineAt: new Date(Date.now() + 60_000).toISOString(), expectedRevision: undefined,
    idempotencyKey: "generate-once", signal: { aborted: false, throwIfAborted() {} },
    vault: {
      async put(request) { puts++; const binding = { bindingRef: `vault-binding-${puts}` }; values.set(binding.bindingRef, new Uint8Array(request.value)); return { binding, revision: 1 }; },
      async withSecret(request, use) { return use(new Uint8Array(values.get(request.binding.bindingRef))); },
      async remove(request) { values.delete(request.binding.bindingRef); return { state: "deleted" }; },
    },
  };
  return { handler: service.handler(), context, puts, putCount: () => puts, values, serviceCalls };
}

const caller = { extensionId: "com.puzed.platform", providerId: "com.puzed.platform/vm" };

test("managed key generation returns only public material and replays durably", async () => {
  const f = await fixture();
  const request = { operation: "managed-binding.generate", payload: { ownerProfileId: "puzed-profile", operationId: "create-vm" }, caller };
  const first = await f.handler.call(request, f.context); const replay = await f.handler.call(request, f.context);
  assert.deepEqual(replay, first); assert.match(first.bindingId, /^puzed-ssh:/); assert.match(first.publicKey, /^ssh-rsa /);
  assert.equal(JSON.stringify(first).includes("PRIVATE KEY"), false); assert.equal("bindingRef" in first, false);
  assert.equal(f.putCount(), 1); assert.equal(f.values.size, 1);
  const privateKey = [...f.values.values()][0];
  const parsed = sshUtils.parseKey(Buffer.from(privateKey));
  assert.equal(parsed instanceof Error, false);
  assert.equal(Buffer.from(first.publicKey.split(/\s+/u)[1], "base64").equals(parsed.getPublicSSH()), true);
});

test("managed binding calls reject an undeclared caller identity at the target", async () => {
  const f = await fixture();
  await assert.rejects(f.handler.call({ operation: "managed-binding.generate", payload: { ownerProfileId: "x", operationId: "y" }, caller: { extensionId: "evil.extension", providerId: "evil/provider" } }, f.context), /unavailable to this caller/);
  assert.equal(f.putCount(), 0);
});

test("managed binding persists an SSH-verified canonical root before serving a terminal", async () => {
  const f = await fixture();
  const generated = await f.handler.call({ operation: "managed-binding.generate", payload: { ownerProfileId: "puzed-profile", operationId: "canonical-root" }, caller }, f.context);
  const bound = await f.handler.call({ operation: "managed-binding.bind", payload: {
    bindingId: generated.bindingId, machineId: "machine-1", host: "192.0.2.10", port: 22, username: "vms", root: "~",
  }, caller }, f.context);
  const verified = await f.handler.call({ operation: "managed-binding.verify", payload: { bindingId: generated.bindingId }, caller }, { ...f.context, expectedRevision: bound.revision });

  assert.equal(verified.canonicalRoot, "/home/vms");
  assert.equal(verified.revision, bound.revision);
  await f.handler.call({ operation: "managed-binding.service", payload: {
    bindingId: generated.bindingId, expectedRevision: verified.revision, capability: "terminal", operation: "create", projectId: "project-1", input: {},
  }, caller }, { ...f.context, expectedRevision: verified.revision });

  assert.equal(f.serviceCalls.at(-1).providerState.root, "/home/vms");
});
