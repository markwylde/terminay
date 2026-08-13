import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionProfileService } from "../dist/extensions/profileService.js";
import { ProjectEnvironmentRepository } from "../dist/projectEnvironment/repository.js";

const definition = { providerId: "com.terminay.ssh/connection", displayName: "SSH server", capabilities: ["terminal", "filesystem"], profileForm: { id: "ssh-profile", title: "SSH", submitLabel: "Save", sections: [{ id: "auth", title: "Auth", fields: [{ id: "display-name", type: "text", label: "Name" }, { id: "hostname", type: "text", label: "Host" }, { id: "password", type: "secret", label: "Password" }] }] } };

test("extension profiles keep secrets in the vault and create an SSH environment", async () => {
  let durable; const repository = new ProjectEnvironmentRepository({ async load() { return durable; }, async commit(value) { durable = structuredClone(value); } }, "server-profile"); await repository.load();
  const secrets = new Map(); const bindings = new Map(); const invocations = [];
  const hosts = {
    providerDefinitions: () => [definition],
    statuses: () => [{ extensionId: "com.terminay.ssh", state: "running", providers: [definition] }],
    async invokeProvider(input) { invocations.push(input); if (input.callback === "testProfile") return []; return { state: "ready", providerState: { profileId: input.request.profileId }, status: { state: "available", revision: 1, defaultRoot: "/srv/project" } }; },
  };
  const vault = { vault: { async put({ id, value }) { secrets.set(id, new Uint8Array(value)); }, async remove(id) { secrets.delete(id); } }, extensionSecrets: { upsertBinding(binding) { bindings.set(`${binding.profileId}:${binding.fieldId}`, binding); }, removeBinding(_extensionId, profileId, fieldId) { bindings.delete(`${profileId}:${fieldId}`); } } };
  const service = new ExtensionProfileService(repository, hosts, vault);
  const context = { clientId: "client", signal: new AbortController().signal, idempotencyKey: "create-profile" };
  const result = await service.createProfile(definition.providerId, { "display-name": "Build host", hostname: "build.example", password: "PASSWORD-SENTINEL" }, context);
  assert.equal(result.profile.name, "Build host"); assert.equal(result.environments.length, 1); assert.equal(result.environments[0].defaultRoot, "/srv/project");
  assert.equal(JSON.stringify(result).includes("PASSWORD-SENTINEL"), false); assert.equal(secrets.size, 1); assert.equal(bindings.size, 1);
  await repository.commit(0, (state) => ({ ...state, profiles: { [result.profile.id]: result.profile }, environments: { ...state.environments, [result.environments[0].id]: result.environments[0] } }));
  bindings.clear(); const restored = new ExtensionProfileService(repository, hosts, vault); const snapshot = await restored.get("com.terminay.ssh", definition.providerId, result.profile.id, context.signal);
  assert.deepEqual(snapshot.secretFields, ["password"]); assert.equal(bindings.size, 1); assert.equal(JSON.stringify(snapshot.values).includes("PASSWORD-SENTINEL"), false); assert.deepEqual(invocations.map((item) => item.callback), ["testProfile", "createEnvironment"]);
});
