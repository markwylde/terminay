import { namespacedId } from "./constants.js";
import type { AgentProviderContribution, DeclarativeForm, ProviderDefinition, TerminayExtensionManifest } from "./types.js";

export const fixtureExtensionId = "dev.terminay.fixture";

export const validManifestFixture: TerminayExtensionManifest = Object.freeze({
  manifestVersion: 1,
  id: fixtureExtensionId,
  displayName: "Fixture Environment",
  description: "A portable conformance fixture.",
  api: "^1.0.0",
  engines: { terminay: ">=1.0.0", node: ">=22" },
  entrypoint: "dist/extension.js",
  permissions: ["configuration:read", "data:write"],
  contributes: {
    projectEnvironments: [{
      id: namespacedId(fixtureExtensionId, "fixture"),
      displayName: "Fixture",
      capabilities: ["terminal", "filesystem"],
    }],
  },
} satisfies TerminayExtensionManifest);

export const validFormFixture: DeclarativeForm = Object.freeze({
  id: "profile",
  title: "Fixture profile",
  sections: [{
    id: "connection",
    title: "Connection",
    fields: [
      { id: "url", type: "url", label: "URL", required: true },
      { id: "token", type: "secret", label: "Token", required: true },
      { id: "unsafe", type: "checkbox", label: "Allow unsafe mode" },
    ],
  }],
  submitLabel: "Save profile",
} satisfies DeclarativeForm);

export const hostileManifestFixtures: Readonly<Record<string, unknown>> = Object.freeze({
  unknownField: { ...validManifestFixture, renderer: "./render.js" },
  escapingEntrypoint: { ...validManifestFixture, entrypoint: "../server.js" },
  wrongNamespace: {
    ...validManifestFixture,
    contributes: { projectEnvironments: [{ ...validManifestFixture.contributes.projectEnvironments![0], id: "example.other/provider" }] },
  },
  coreCollision: {
    ...validManifestFixture,
    contributes: { projectEnvironments: [{ ...validManifestFixture.contributes.projectEnvironments![0], id: "terminal.create" }] },
  },
  unknownPermission: { ...validManifestFixture, permissions: ["server:everything"] },
});

export const validProviderDefinitionFixture: ProviderDefinition = Object.freeze({
  providerId: namespacedId(fixtureExtensionId, "fixture"),
  displayName: "Fixture",
  capabilities: ["terminal", "filesystem"],
  profileForm: validFormFixture,
  createForm: {
    id: "create",
    title: "Create fixture environment",
    sections: [{ id: "size", title: "Size", fields: [{
      id: "preset", type: "preset-cards", label: "Preset", options: [
        { value: "small", label: "Small" }, { value: "large", label: "Large" },
      ],
    }] }],
    submitLabel: "Create",
  },
} satisfies ProviderDefinition);

/** A provider-neutral manifest contribution for public agent SDK conformance. */
export const validAgentProviderContributionFixture: AgentProviderContribution = Object.freeze({
  id: namespacedId(fixtureExtensionId, "agent"),
  displayName: "Fixture Agent",
  processMatchers: [{ executableName: "fixture-agent" }],
  mappings: [{ mappingVersion: "0.1", providerVersionRange: ">=0.1" }],
  requiredEnvironmentVariables: ["FIXTURE_AGENT_HOME"],
  requiredEnvironmentCapabilities: ["process-observation", "agent-journal"],
} satisfies AgentProviderContribution);

export const validAgentManifestFixture: TerminayExtensionManifest = Object.freeze({
  manifestVersion: 1,
  id: fixtureExtensionId,
  displayName: "Fixture Agent Extension",
  api: "^1.1.0",
  engines: { terminay: ">=1.0.0", node: ">=22" },
  entrypoint: "dist/extension.js",
  permissions: ["agent-observation"],
  contributes: { agentProviders: [validAgentProviderContributionFixture] },
} satisfies TerminayExtensionManifest);
