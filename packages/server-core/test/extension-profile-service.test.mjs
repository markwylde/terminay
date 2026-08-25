import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionProfileService } from "../dist/extensions/profileService.js";
import { ProjectEnvironmentRepository } from "../dist/projectEnvironment/repository.js";

const definition = { providerId: "dev.example.direct/connection", displayName: "Direct server", capabilities: ["terminal", "filesystem"], profileForm: { id: "direct-profile", title: "Direct", submitLabel: "Save", sections: [{ id: "auth", title: "Auth", fields: [{ id: "display-name", type: "text", label: "Name" }, { id: "hostname", type: "text", label: "Host" }, { id: "password", type: "secret", label: "Password" }] }] } };

test("an activated provider can declaratively opt into profile-save environment creation", async () => {
  let durable; const repository = new ProjectEnvironmentRepository({ async load() { return durable; }, async commit(value) { durable = structuredClone(value); } }, "server-profile"); await repository.load();
  const secrets = new Map(); const bindings = new Map(); const invocations = [];
  const hosts = {
    providerDefinitions: () => [definition],
    statuses: () => [{ extensionId: "dev.example.direct", state: "running", providers: [definition] }],
    activatedProjectEnvironmentContributions: () => [{ id: definition.providerId, displayName: definition.displayName, capabilities: definition.capabilities, profileSave: { createEnvironment: true } }],
    async invokeProvider(input) { invocations.push(input); if (input.callback === "testProfile") return []; return { state: "ready", providerState: { profileId: input.request.profileId }, status: { state: "available", revision: 1, defaultRoot: "/srv/project" } }; },
  };
  const vault = { vault: { async put({ id, value }) { secrets.set(id, new Uint8Array(value)); }, async remove(id) { secrets.delete(id); } }, extensionSecrets: { upsertBinding(binding) { bindings.set(`${binding.profileId}:${binding.fieldId}`, binding); }, removeBinding(_extensionId, profileId, fieldId) { bindings.delete(`${profileId}:${fieldId}`); } } };
  const service = new ExtensionProfileService(repository, hosts, vault);
  const context = { clientId: "client", signal: new AbortController().signal, idempotencyKey: "create-profile" };
  const result = await service.createProfile(definition.providerId, { "display-name": "Build host", hostname: "build.example", password: "PASSWORD-SENTINEL" }, context);
  assert.equal(result.profile.name, "Build host"); assert.equal(result.environments.length, 1); assert.equal(result.environments[0].defaultRoot, "/srv/project");
  assert.equal(JSON.stringify(result).includes("PASSWORD-SENTINEL"), false); assert.equal(secrets.size, 1); assert.equal(bindings.size, 1);
  await repository.commit(0, (state) => ({ ...state, profiles: { [result.profile.id]: result.profile }, environments: { ...state.environments, [result.environments[0].id]: result.environments[0] } }));
  bindings.clear(); const restored = new ExtensionProfileService(repository, hosts, vault); const snapshot = await restored.get("dev.example.direct", definition.providerId, result.profile.id, context.signal);
  assert.deepEqual(snapshot.secretFields, ["password"]); assert.equal(bindings.size, 1); assert.equal(JSON.stringify(snapshot.values).includes("PASSWORD-SENTINEL"), false); assert.deepEqual(invocations.map((item) => item.callback), ["testProfile", "createEnvironment"]);
});

test("profile save never guesses environment creation without the explicit contribution opt-in", async () => {
  let durable; const repository = new ProjectEnvironmentRepository({ async load() { return durable; }, async commit(value) { durable = structuredClone(value); } }, "server-profile"); await repository.load();
  const calls = [];
  const hosts = {
    providerDefinitions: () => [definition],
    statuses: () => [{ extensionId: "dev.example.provisioner", state: "running", providers: [definition] }],
    activatedProjectEnvironmentContributions: () => [{ id: definition.providerId, displayName: definition.displayName, capabilities: definition.capabilities }],
    async invokeProvider(input) { calls.push(input.callback); return input.callback === "testProfile" ? [] : { state: "ready", providerState: {}, status: { state: "available", revision: 1 } }; },
  };
  const vault = { vault: { async put() {}, async remove() {} }, extensionSecrets: { upsertBinding() {}, removeBinding() {} } };
  const service = new ExtensionProfileService(repository, hosts, vault);
  const result = await service.createProfile(definition.providerId, { "display-name": "VM account", hostname: "api.example" }, { clientId: "client", signal: new AbortController().signal });
  assert.equal(result.environments.length, 0);
  assert.deepEqual(calls, ["testProfile"]);
});

test("profile validation returns the provider's explicit public issue rather than a generic command failure", async () => {
  let durable; const repository = new ProjectEnvironmentRepository({ async load() { return durable; }, async commit(value) { durable = structuredClone(value); } }, "server-profile"); await repository.load();
  const hosts = {
    providerDefinitions: () => [definition],
    statuses: () => [{ extensionId: "dev.example.provisioner", state: "running", providers: [definition] }],
    activatedProjectEnvironmentContributions: () => [],
    async invokeProvider() { return [{ message: "Puzed request failed (403)." }]; },
  };
  const vault = { vault: { async put() {}, async remove() {} }, extensionSecrets: { upsertBinding() {}, removeBinding() {} } };
  const service = new ExtensionProfileService(repository, hosts, vault);
  await assert.rejects(
    () => service.createProfile(definition.providerId, { "display-name": "VM account", hostname: "api.example" }, { clientId: "client", signal: new AbortController().signal }),
    (error) => error?.code === "validation" && error.message === "Puzed request failed (403).",
  );
});
