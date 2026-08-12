import assert from "node:assert/strict";
import test from "node:test";
import {
  PuzedSshCompositionBroker,
  PuzedSshCompositionService,
  PUZED_EXTENSION_ID,
  SSH_EXTENSION_ID,
  SSH_PROVIDER_ID,
} from "../dist/extensions/puzedSshComposition.js";
import { RepositoryCanonicalProjectOpener } from "../dist/extensions/puzedSshProjectAdapter.js";
import { ProjectEnvironmentRepository } from "../dist/projectEnvironment/repository.js";
import { createInitialWorkspace, WorkspaceStore } from "../dist/workspace.js";
import { ExtensionHostComposedSshRuntime } from "../dist/extensions/composedSshRuntime.js";
import { mkdtemp } from "node:fs/promises";
import { chmod, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const manifest = { id: PUZED_EXTENSION_ID, extensionDependencies: [{ extensionId: SSH_EXTENSION_ID, apiRange: "^1.0.0" }] };

function fixture(initial) {
  let durable = initial;
  const secrets = new Map(); const profiles = new Map(); const calls = []; let projectCalls = 0;
  const service = new PuzedSshCompositionService({
    backend: { async load() { return structuredClone(durable); }, async commit(value) { durable = structuredClone(value); } },
    vault: {
      async put(input) { assert.equal(new TextDecoder().decode(input.value).includes("PRIVATE KEY"), true); secrets.set(input.id, new Uint8Array(input.value)); },
      async remove(id) { secrets.delete(id); },
    },
    ssh: {
      async createBinding(input) { calls.push(["create", structuredClone(input)]); profiles.set(input.bindingId, { ...input, revision: 1 }); return { revision: 1 }; },
      async updateBinding(input) { calls.push(["update", structuredClone(input)]); const prior = profiles.get(input.bindingId); profiles.set(input.bindingId, { ...prior, ...input, revision: input.expectedRevision + 1 }); return { revision: input.expectedRevision + 1 }; },
      async verifyBinding(input) { calls.push(["verify", structuredClone(input)]); const profile = profiles.get(input.bindingId); return { state: "ready", revision: profile.revision, canonicalRoot: "/srv/project", logicalHostIdentity: profile.logicalHostIdentity }; },
      async approveTrust(input) { calls.push(["approve", structuredClone(input)]); return { revision: input.expectedRevision }; },
      async removeBinding(id) { profiles.delete(id); },
    },
    projects: { async open(input) { projectCalls++; calls.push(["open", structuredClone(input)]); return { projectId: "project-1", environmentId: input.environmentId }; } },
  });
  const broker = new PuzedSshCompositionBroker(service); broker.registerManifest(manifest);
  const call = (operation, payload, key = `key-${operation}`) => broker.request({ extensionId: PUZED_EXTENSION_ID, operation: "provider.call", payload: { request: { providerId: SSH_PROVIDER_ID, operation, payload }, context: { idempotencyKey: key } } }, new AbortController().signal);
  return { service, broker, call, secrets, profiles, calls, projectCalls: () => projectCalls, durable: () => durable };
}

test("dedicated key stays host/SSH-owned and Puzed receives only public key plus opaque binding", async () => {
  const f = fixture(); const result = await f.call("generate-dedicated-key", { profileId: "platform-a", operationId: "operation-a", logicalHostIdentityHint: "puzed:platform-a:pending:operation-a" });
  assert.match(result.publicKey, /^ssh-ed25519 /); assert.match(result.sshBindingId, /^puzed-ssh:/); assert.deepEqual(Object.keys(result).sort(), ["publicKey", "sshBindingId"]);
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false); assert.equal(JSON.stringify(f.durable()).includes("PRIVATE KEY"), false);
  assert.equal(f.secrets.size, 1); assert.equal(f.calls[0][0], "create"); assert.match(f.calls[0][1].privateKeySecretId, /^extensions\.ssh\.composed\./);
});

test("dedicated vault key is standards-readable OpenSSH Ed25519 and matches its public half", async () => {
  const context = fixture(); const generated = await context.service.generate({ profileId: "platform", operationId: "key-format" }, "key-format", new AbortController().signal);
  const privateKey = [...context.secrets.values()][0]; assert.ok(privateKey);
  const root = await mkdtemp(join(tmpdir(), "terminay-key-format-")); const file = join(root, "id_ed25519"); await writeFile(file, privateKey); await chmod(file, 0o600);
  const parsed = spawnSync("ssh-keygen", ["-y", "-f", file], { encoding: "utf8" }); assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(parsed.stdout.trim().split(" ").slice(0, 2).join(" "), generated.publicKey.split(" ").slice(0, 2).join(" "));
});

test("caller must declare exact SSH extension dependency and provider", async () => {
  const f = fixture(); const request = { operation: "provider.call", payload: { request: { providerId: SSH_PROVIDER_ID, operation: "verify", payload: { sshBindingId: "missing" } }, context: {} } };
  await assert.rejects(f.broker.request({ extensionId: "evil.extension", ...request }, new AbortController().signal), /caller is not authorized/);
  const broker = new PuzedSshCompositionBroker(f.service); broker.registerManifest({ id: PUZED_EXTENSION_ID, extensionDependencies: [] });
  await assert.rejects(broker.request({ extensionId: PUZED_EXTENSION_ID, ...request }, new AbortController().signal), /dependency is not declared/);
  await assert.rejects(f.broker.request({ extensionId: PUZED_EXTENSION_ID, operation: "provider.call", payload: { request: { providerId: "evil/provider", operation: "verify", payload: {} }, context: {} } }, new AbortController().signal), /not authorized/);
});

test("machine binding is stable across dial changes and idempotent open validates SSH first", async () => {
  const f = fixture(); const generated = await f.call("generate-dedicated-key", { profileId: "platform-a", operationId: "operation-a" });
  const first = await f.call("bind-machine", { sshBindingId: generated.sshBindingId, machineId: "machine-a", host: "10.0.0.2", port: 22, username: "vms", root: "~/app" });
  assert.equal(first.logicalHostIdentity, "puzed:platform-a:machine-a");
  const second = await f.call("update-binding", { sshBindingId: generated.sshBindingId, machineId: "machine-a", host: "10.0.0.9", port: 22, username: "vms", root: "~/app" });
  assert.equal(second.logicalHostIdentity, first.logicalHostIdentity); assert.equal(f.profiles.get(generated.sshBindingId).host, "10.0.0.9");
  const opened = await f.call("open-project", { sshBindingId: generated.sshBindingId, displayName: "VM project" }, "open-same");
  const replay = await f.call("open-project", { sshBindingId: generated.sshBindingId, displayName: "VM project" }, "open-same");
  assert.deepEqual(replay, opened); assert.equal(f.projectCalls(), 1); assert.deepEqual(f.calls.slice(-2).map((item) => item[0]), ["verify", "open"]);
});

test("Puzed verify/open descriptor implicitly updates the host-owned binding without exposing a profile", async () => {
  const f = fixture(); const generated = await f.call("generate-dedicated-key", { profileId: "platform-a", operationId: "operation-a" });
  const descriptor = { providerId: SSH_PROVIDER_ID, sshBindingId: generated.sshBindingId, logicalHostIdentity: "puzed:platform-a:machine-a", host: "192.0.2.7", port: 22, username: "vms", defaultRoot: "~/repo" };
  assert.equal((await f.call("verify", descriptor)).state, "ready");
  const opened = await f.call("open-project", descriptor, "open-descriptor"); assert.equal(opened.projectId, "project-1");
  const profile = f.profiles.get(generated.sshBindingId); assert.equal(profile.logicalHostIdentity, descriptor.logicalHostIdentity); assert.equal(profile.host, descriptor.host);
});

test("restart loads durable idempotency receipts without regenerating credentials", async () => {
  const first = fixture(); const result = await first.call("generate-dedicated-key", { profileId: "platform-a", operationId: "operation-a" }, "stable-key");
  const restarted = fixture(first.durable()); const replay = await restarted.call("generate-dedicated-key", { profileId: "platform-a", operationId: "operation-a" }, "stable-key");
  assert.deepEqual(replay, result); assert.equal(restarted.secrets.size, 0); assert.equal(restarted.calls.length, 0);
  await assert.rejects(restarted.call("generate-dedicated-key", { profileId: "platform-a", operationId: "changed" }, "stable-key"), /reused/);
});

test("SSH binding failure rolls back generated private key", async () => {
  let removed; const service = new PuzedSshCompositionService({ backend: { async load() {}, async commit() {} }, vault: { async put() {}, async remove(id) { removed = id; } }, ssh: { async createBinding() { throw new Error("SSH unavailable"); }, async updateBinding() { throw new Error(); }, async verifyBinding() { throw new Error(); }, async approveTrust() { throw new Error(); }, async removeBinding() {} }, projects: { async open() { throw new Error(); } } });
  await assert.rejects(service.generate({ profileId: "platform", operationId: "operation" }, "key", new AbortController().signal), /SSH unavailable/); assert.match(removed, /^extensions\.ssh\.composed\./);
});

test("durable receipt failure compensates both SSH binding and vault secret", async () => {
  const secrets = new Set(); const profiles = new Set(); const service = new PuzedSshCompositionService({ backend: { async load() {}, async commit() { throw new Error("disk full"); } }, vault: { async put(input) { secrets.add(input.id); }, async remove(id) { secrets.delete(id); } }, ssh: { async createBinding(input) { profiles.add(input.bindingId); return { revision: 1 }; }, async updateBinding() { throw new Error(); }, async verifyBinding() { throw new Error(); }, async approveTrust() { throw new Error(); }, async removeBinding(id) { profiles.delete(id); } }, projects: { async open() { throw new Error(); } } });
  await assert.rejects(service.generate({ profileId: "platform", operationId: "operation" }, "key", new AbortController().signal), /disk full/); assert.equal(secrets.size, 0); assert.equal(profiles.size, 0);
});

test("canonical opener commits one immutable environment/project binding and replays", async () => {
  let durable; const environments = new ProjectEnvironmentRepository({ async load() { return durable; }, async commit(value) { durable = structuredClone(value); } }, "server-a"); await environments.load();
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a")); const opener = new RepositoryCanonicalProjectOpener(environments, workspace); const input = { environmentId: "puzed:platform:machine", displayName: "Machine", sshBindingId: "binding-a", sshRevision: 3, canonicalRoot: "/srv/app", puzedProfileId: "platform", machineId: "machine" };
  const first = await opener.open(input, new AbortController().signal); const replay = await opener.open(input, new AbortController().signal); assert.deepEqual(replay, first);
  assert.equal(workspace.state.projects[first.projectId].projectEnvironmentId, input.environmentId); assert.equal(workspace.state.projects[first.projectId].environmentRevision, 3);
  const stored = (await environments.load()).environments[input.environmentId]; assert.equal(stored.providerId, SSH_PROVIDER_ID); assert.equal(stored.providerState.sshBindingId, "binding-a"); assert.equal(stored.projectReferenceCount, 1);
});

test("Puzed management and SSH runtime outages preserve the other side's durable identity", async () => {
  let durable; const environments = new ProjectEnvironmentRepository({ async load() { return durable; }, async commit(value) { durable = structuredClone(value); } }, "server-outage"); await environments.load();
  const workspace = new WorkspaceStore(createInitialWorkspace("server-outage")); const opener = new RepositoryCanonicalProjectOpener(environments, workspace);
  const input = { environmentId: "puzed:platform:machine", displayName: "Machine", sshBindingId: "binding-stable", sshRevision: 2, canonicalRoot: "/srv/app", puzedProfileId: "platform", machineId: "machine" };
  const opened = await opener.open(input, new AbortController().signal);
  const managementOutage = new PuzedSshCompositionService({ backend: { async load() { throw new Error("Puzed unavailable"); }, async commit() {} }, vault: { async put() {}, async remove() {} }, ssh: { async createBinding() { throw new Error(); }, async updateBinding() { throw new Error(); }, async verifyBinding() { throw new Error(); }, async approveTrust() { throw new Error(); }, async removeBinding() {} }, projects: opener });
  await assert.rejects(managementOutage.snapshot(), /Puzed unavailable/); assert.equal(workspace.state.projects[opened.projectId].projectEnvironmentId, input.environmentId);
  const stored = (await environments.load()).environments[input.environmentId]; assert.equal(stored.providerState.sshBindingId, "binding-stable"); assert.equal(stored.status, "ready");
});

test("production SSH adapter gives private secret metadata only to SSH and survives restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-composed-ssh-")); const calls = [];
  const hosts = { async invokeProvider(input) { calls.push(structuredClone(input)); if (input.callback === "createEnvironment") return { state: "ready", providerState: { profileId: input.request.profileId, root: "/srv/app" }, status: { state: "available", defaultRoot: "/srv/app", revision: 1 } }; return { state: "available", defaultRoot: "/srv/app", revision: 1 }; } };
  const first = new ExtensionHostComposedSshRuntime(join(root, "bindings.json"), hosts); await first.createBinding({ bindingId: "binding-a", profileId: "composed:binding-a", logicalHostIdentity: "pending", privateKeySecretId: "vault-secret-a" }, new AbortController().signal);
  const updated = await first.updateBinding({ bindingId: "binding-a", expectedRevision: 1, logicalHostIdentity: "puzed:platform:machine", host: "192.0.2.4", port: 22, username: "vms", root: "~/app" }, new AbortController().signal); assert.equal(updated.revision, 2);
  assert.equal(calls[0].providerId, SSH_PROVIDER_ID); assert.equal(calls[0].request.values.privateKeySecretRef, "vault-secret-a");
  const restarted = new ExtensionHostComposedSshRuntime(join(root, "bindings.json"), hosts); const status = await restarted.verifyBinding({ bindingId: "binding-a", expectedRevision: 2 }, new AbortController().signal); assert.equal(status.state, "ready"); assert.equal(status.logicalHostIdentity, "puzed:platform:machine");
});
