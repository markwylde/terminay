import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  EXTENSION_EVENT_NAMES,
  EXTENSION_LIMITS,
  EXTENSION_OPERATION_NAMES,
  OPERATION_POLICIES,
  createProviderDependencyTargetHarness,
  hostileManifestFixtures,
  namespacedId,
  validFormFixture,
  validManifestFixture,
  validProviderDefinitionFixture,
  validateDeclarativeForm,
  validateEnvironmentActionResult,
  validateAgentBindingFingerprint,
  validateAgentLifecycleEvent,
  validateAgentModelMetadata,
  validateAgentObservationDiagnostic,
  validateAgentProviderContribution,
  validateAgentProviderDefinition,
  validateAgentSessionBindingRequest,
  validateExtensionManifest,
  validateOptionSourceResult,
  validateProgressPresentation,
  validateProviderDefinition,
  validateProviderDependencyCallContext,
  validateProviderDependencyHandler,
  validateProviderDependencyRequest,
  validateProviderDependencyTargetRequest,
  validateProvisioningResult,
  validateSshAgentIdentities,
  validateSshAgentSignature,
  validateValidationIssues,
} from "../dist/index.js";

test("every public extension operation and event obeys the wire protocol grammar", () => {
  const operationPattern = /^[a-z][a-z0-9._:-]{0,255}$/;
  for (const name of [...EXTENSION_OPERATION_NAMES, ...EXTENSION_EVENT_NAMES]) {
    assert.match(name, operationPattern, name);
  }
});

test("valid fixture conforms to the closed manifest schema", () => {
  assert.deepEqual(validateExtensionManifest(validManifestFixture), { ok: true, value: validManifestFixture });
});

test("hostile manifests fail closed before import", () => {
  for (const [name, fixture] of Object.entries(hostileManifestFixtures)) {
    const result = validateExtensionManifest(fixture);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("manifest arrays reject duplicates and unsupported capabilities", () => {
  const contribution = validManifestFixture.contributes.projectEnvironments[0];
  const result = validateExtensionManifest({
    ...validManifestFixture,
    permissions: ["network", "network"],
    contributes: { projectEnvironments: [{ ...contribution, capabilities: ["terminal", "telepathy"] }] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "duplicate"));
  assert.ok(result.issues.some((issue) => issue.code === "unknown_capability"));
});

test("provider dependency manifest allowlists are closed, unique, and bounded", () => {
  const contribution = validManifestFixture.contributes.projectEnvironments[0];
  const allowed = validateExtensionManifest({
    ...validManifestFixture,
    contributes: { projectEnvironments: [{
      ...contribution,
      dependencyOperations: [{ name: "resource.read" }, { name: "resource.update" }],
    }] },
  });
  assert.equal(allowed.ok, true);

  for (const [name, dependencyOperations, code] of [
    ["duplicate operation", [{ name: "resource.read" }, { name: "resource.read" }], "duplicate"],
    ["command-shaped operation", [{ name: "resource read" }], "invalid_operation"],
    ["unknown operation field", [{ name: "resource.read", command: "read" }], "unknown_field"],
    ["too many operations", Array.from({ length: EXTENSION_LIMITS.providerDependencyOperations + 1 }, (_, index) => ({ name: `resource.op-${index}` })), "invalid_array"],
  ]) {
    const result = validateExtensionManifest({
      ...validManifestFixture,
      contributes: { projectEnvironments: [{ ...contribution, dependencyOperations }] },
    });
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.some((issue) => issue.code === code), name);
  }
});

test("public dependency target harness validates calls, cancellation, and JSON results", async () => {
  const cancelled = { aborted: true, throwIfAborted() { throw new Error("cancelled"); } };
  const seen = [];
  const harness = createProviderDependencyTargetHarness({
    async call(request, context) {
      seen.push({ request, context });
      context.signal.throwIfAborted();
      return { operation: request.operation, revision: context.expectedRevision, idempotencyKey: context.idempotencyKey };
    },
  });
  const request = {
    operation: "resource.update",
    payload: { enabled: true },
    caller: { extensionId: "dev.terminay.caller", providerId: "dev.terminay.caller/source" },
  };
  const result = await harness.call(request, {
    deadlineAt: "2030-01-01T00:00:00.000Z", idempotencyKey: "mutation-1", expectedRevision: 4,
  });
  assert.deepEqual(result, { operation: "resource.update", revision: 4, idempotencyKey: "mutation-1" });
  assert.equal(seen[0].request.caller.extensionId, "dev.terminay.caller", "caller identity is the host-delivered target request");
  assert.equal(seen[0].context.deadlineAt, "2030-01-01T00:00:00.000Z");
  await assert.rejects(() => harness.call(request, { signal: cancelled }), /cancelled/);

  await assert.rejects(() => createProviderDependencyTargetHarness({ async call() { return new Date(); } }).call(request), /Invalid provider dependency result/);
  await assert.rejects(() => harness.call({ ...request, caller: { extensionId: "dev.terminay.caller", providerId: "dev.other/source" } }), /Invalid provider dependency target request/);
});

test("dependency request and context validators reject unbounded or forged DTOs", () => {
  assert.equal(validateProviderDependencyRequest({ providerId: "dev.terminay.target/cache", operation: "resource.read", payload: null }).ok, true);
  assert.equal(validateProviderDependencyTargetRequest({ operation: "resource.read", payload: [], caller: { extensionId: "dev.terminay.caller", providerId: "dev.terminay.caller/source" } }).ok, true);
  assert.equal(validateProviderDependencyCallContext({ deadlineAt: "2030-01-01T00:00:00.000Z", signal: { aborted: false, throwIfAborted() {} }, expectedRevision: 0 }).ok, true);
  assert.equal(validateProviderDependencyHandler({ call: async () => null }).ok, true);

  for (const [name, result] of [
    ["oversized payload", validateProviderDependencyRequest({ providerId: "dev.terminay.target/cache", operation: "resource.read", payload: "x".repeat(EXTENSION_LIMITS.providerDependencyPayloadBytes) })],
    ["forged caller ownership", validateProviderDependencyTargetRequest({ operation: "resource.read", payload: null, caller: { extensionId: "dev.terminay.caller", providerId: "dev.other/source" } })],
    ["negative expected revision", validateProviderDependencyCallContext({ deadlineAt: "2030-01-01T00:00:00.000Z", signal: { aborted: false, throwIfAborted() {} }, expectedRevision: -1 })],
    ["host callback field", validateProviderDependencyHandler({ call: async () => null, authorize() {} })],
  ]) {
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("SSH agent access is an explicit supported manifest permission", () => {
  const result = validateExtensionManifest({ ...validManifestFixture, permissions: ["network", "ssh-agent:use"] });
  assert.equal(result.ok, true);
});

test("agent-observation is an additive manifest permission required by agent contributions", () => {
  const agentProvider = {
    id: "dev.terminay.fixture/agent",
    displayName: "Fixture Agent",
    requiredEnvironmentCapabilities: ["process-observation", "agent-journal"],
  };
  const valid = validateExtensionManifest({
    ...validManifestFixture,
    permissions: [...validManifestFixture.permissions, "agent-observation"],
    contributes: { agentProviders: [agentProvider] },
  });
  assert.equal(valid.ok, true);

  const missingPermission = validateExtensionManifest({
    ...validManifestFixture,
    contributes: { agentProviders: [agentProvider] },
  });
  assert.equal(missingPermission.ok, false);
  assert.ok(missingPermission.issues.some((issue) => issue.path === "$.permissions" && issue.code === "missing_permission"));
});

test("project-environment and agent-provider contributions are independently optional and may be combined", () => {
  const agentProvider = {
    id: "dev.terminay.fixture/agent",
    displayName: "Fixture Agent",
    requiredEnvironmentCapabilities: ["process-observation"],
  };
  assert.equal(validateExtensionManifest(validManifestFixture).ok, true, "project environment only");
  assert.equal(validateExtensionManifest({
    ...validManifestFixture,
    permissions: [...validManifestFixture.permissions, "agent-observation"],
    contributes: { agentProviders: [agentProvider] },
  }).ok, true, "agent provider only");
  assert.equal(validateExtensionManifest({
    ...validManifestFixture,
    permissions: [...validManifestFixture.permissions, "agent-observation"],
    contributes: {
      projectEnvironments: validManifestFixture.contributes.projectEnvironments,
      agentProviders: [agentProvider],
    },
  }).ok, true, "combined contributions");

  const noContributions = validateExtensionManifest({ ...validManifestFixture, contributes: {} });
  assert.equal(noContributions.ok, false);
  assert.ok(noContributions.issues.some((issue) => issue.path === "$.contributes" && issue.code === "missing_contribution"));
});

test("agent provider contribution declarations are namespaced, bounded, and declarative", () => {
  const valid = {
    id: "dev.terminay.fixture/agent",
    displayName: "Fixture Agent",
    description: "Observes the fixture CLI.",
    icon: "terminal",
    platforms: ["darwin", "linux"],
    processMatchers: [{ executableName: "fixture-agent", arguments: ["--json"] }],
    mappings: [{ mappingVersion: "0.1", providerVersionRange: ">=1" }],
    requiredEnvironmentCapabilities: ["process-observation", "agent-journal"],
  };
  assert.equal(validateAgentProviderContribution(valid, "dev.terminay.fixture").ok, true);

  for (const [name, value, code] of [
    ["foreign provider id", { ...valid, id: "dev.other/agent" }, "invalid_namespace"],
    ["unsupported observation capability", { ...valid, requiredEnvironmentCapabilities: ["telepathy"] }, "invalid_capability"],
    ["executable callback", { ...valid, observe: () => {} }, "unknown_field"],
    ["unsafe matcher", { ...valid, processMatchers: [{ executableName: "fixture-agent", command: "fixture-agent --json" }] }, "unknown_field"],
  ]) {
    const result = validateAgentProviderContribution(value, "dev.terminay.fixture");
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.some((issue) => issue.code === code), name);
  }
});

test("agent runtime provider declarations accept only the public callback contract", () => {
  const valid = {
    mappingVersion: "0.1",
    matchesForeground() { return true; },
    async observe() { return { state: "not-bound" }; },
  };
  assert.equal(validateAgentProviderDefinition(valid).ok, true);

  for (const [name, definition] of [
    ["missing matcher", { mappingVersion: "0.1", observe: valid.observe }],
    ["missing observer", { mappingVersion: "0.1", matchesForeground: valid.matchesForeground }],
    ["non-function matcher", { ...valid, matchesForeground: true }],
    ["host lifecycle callback", { ...valid, dispose() {} }],
  ]) {
    const result = validateAgentProviderDefinition(definition);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("agent binding, metadata, and diagnostic validators reject nested or host-owned data", () => {
  assert.equal(validateAgentBindingFingerprint({ kind: "writable-file", file: { id: "file-1" }, metadata: { source: "journal", attempt: 1 } }).ok, true);
  assert.equal(validateAgentSessionBindingRequest({
    providerSessionId: "session-1",
    mappingVersion: "0.1",
    fingerprint: { kind: "writable-file", file: { id: "file-1" }, metadata: { source: "journal" } },
    metadata: { title: "Fixture task" },
  }).ok, true);
  assert.equal(validateAgentModelMetadata({ id: "fixture-1", displayName: "Fixture", contextWindowTokens: 128_000 }).ok, true);
  assert.equal(validateAgentObservationDiagnostic({ reason: "session-not-found", message: "No active session" }).ok, true);

  for (const [name, result] of [
    ["nested fingerprint metadata", validateAgentBindingFingerprint({ kind: "writer", file: { id: "file-1" }, metadata: { nested: { value: "no" } } })],
    ["nested session metadata", validateAgentSessionBindingRequest({ providerSessionId: "session-1", mappingVersion: "0.1", fingerprint: { kind: "writer", file: { id: "file-1" } }, metadata: { nested: ["no"] } })],
    ["host scope in diagnostic", validateAgentObservationDiagnostic({ reason: "session-not-found", terminalId: "terminal-1" })],
    ["unsafe diagnostic payload", validateAgentObservationDiagnostic({ reason: "session-not-found", error: { stack: "secret" } })],
    ["oversized model id", validateAgentModelMetadata({ id: "x".repeat(257) })],
  ]) {
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("public agent lifecycle validator accepts only bounded provider-neutral event DTOs", () => {
  for (const event of [
    { kind: "session.started", title: "Fixture task", model: { id: "fixture-1", displayName: "Fixture" } },
    { kind: "turn.started", turnId: "turn-1", promptText: "Fix the fixtures" },
    { kind: "tool.started", toolId: "tool-1", name: "read_file" },
    { kind: "wait.started", waitId: "wait-1", state: "waiting", reason: "Approval required" },
    { kind: "agent.done", outcome: "success", summary: "Completed" },
    { kind: "subagent.done", subagentId: "child-1", outcome: "cancelled" },
  ]) {
    assert.equal(validateAgentLifecycleEvent(event).ok, true, event.kind);
  }

  for (const [name, event] of [
    ["terminal scope", { kind: "agent.done", outcome: "success", terminalId: "terminal-1" }],
    ["project scope", { kind: "agent.done", outcome: "success", projectId: "project-1" }],
    ["server scope", { kind: "agent.done", outcome: "success", serverId: "server-1" }],
    ["session scope", { kind: "agent.done", outcome: "success", sessionId: "session-1" }],
    ["host sequence", { kind: "agent.done", outcome: "success", sequence: 1 }],
    ["unknown event field", { kind: "agent.done", outcome: "success", rawRecord: { credential: "secret" } }],
    ["oversized title", { kind: "session.started", title: "x".repeat(513) }],
    ["oversized prompt", { kind: "turn.started", turnId: "turn-1", promptText: "x".repeat(4_097) }],
    ["nested metadata", { kind: "session.started", model: { id: "fixture-1", nested: { value: { value: { value: "no" } } } } }],
  ]) {
    const result = validateAgentLifecycleEvent(event);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("declarative form fixture validates and executable UI is rejected", () => {
  assert.equal(validateDeclarativeForm(validFormFixture).ok, true);
  const result = validateDeclarativeForm({ ...validFormFixture, html: "<script />" });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "unknown_field"));
});

test("declarative forms admit bounded defaults and server-owned text suggestions", () => {
  const form = structuredClone(validFormFixture);
  form.sections[0].fields[0] = { ...form.sections[0].fields[0], defaultValue: "vms", suggestionSource: "com.example/name-suggestion", suggestionLabel: "Regenerate" };
  assert.equal(validateDeclarativeForm(form).ok, true);
  assert.equal(validateOptionSourceResult({ options: [{ value: "brave-otter", label: "brave-otter", default: true }] }).ok, true);
  form.sections[0].fields[0].type = "checkbox";
  assert.equal(validateDeclarativeForm(form).ok, false);
});

test("namespacing rejects traversal and core-shaped local ids", () => {
  assert.equal(namespacedId("com.example.ssh", "remote"), "com.example.ssh/remote");
  assert.throws(() => namespacedId("com.example.ssh", "../terminal.create"));
});

test("every fixed operation has exactly one transport permission policy", () => {
  assert.deepEqual(Object.keys(OPERATION_POLICIES).sort(), [...EXTENSION_OPERATION_NAMES].sort());
  assert.ok(EXTENSION_EVENT_NAMES.every((name) => name.includes(".")));
});

test("provider definition and callback DTOs stay bounded and declarative", () => {
  assert.equal(validateProviderDefinition(validProviderDefinitionFixture).ok, true);
  const asynchronousPresetDefinition = structuredClone(validProviderDefinitionFixture);
  asynchronousPresetDefinition.createForm.sections[0].fields[0] = {
    id: "preset",
    type: "preset-cards",
    label: "Preset",
    optionSource: "dev.terminay.fixture/sizes",
  };
  assert.equal(validateProviderDefinition(asynchronousPresetDefinition).ok, true);
  assert.equal(validateOptionSourceResult({ options: [{ value: "one", label: "One" }] }).ok, true);
  const progress = { operationId: "op-1", title: "Creating", resumable: true, stages: [{ id: "boot", label: "Boot VM", state: "active" }] };
  assert.equal(validateProgressPresentation(progress).ok, true);
  assert.equal(validateProvisioningResult({ state: "pending", operationId: "op-1", providerState: { jobId: "1" }, progress, pollAfterMs: 1000 }).ok, true);
  assert.equal(validateEnvironmentActionResult({ state: "pending", operationId: "op-1", providerState: {}, progress }).ok, true);
  assert.equal(validateValidationIssues([{ fieldId: "url", code: "unreachable", message: "Host is unavailable" }]).ok, true);
});

test("provider callback DTO validators reject unsafe or executable values", () => {
  assert.equal(validateOptionSourceResult({ options: [{ value: "one", label: "One", html: "<b>One</b>" }] }).ok, false);
  assert.equal(validateProvisioningResult({ state: "ready", providerState: { callback: () => {} }, status: { state: "available", revision: 1 } }).ok, false);
  assert.equal(validateValidationIssues([{ code: "bad", message: "bad", stack: "secret" }]).ok, false);
});

test("scoped broker types remain absent from JSON presentation contracts", () => {
  const definition = structuredClone(validProviderDefinitionFixture);
  assert.equal(validateProviderDefinition(definition).ok, true);
  assert.equal("profiles" in definition, false);
  assert.equal("secrets" in definition, false);
  assert.equal("sshAgent" in definition, false);
});

test("SSH agent broker payloads are bounded public identities and signatures", () => {
  assert.equal(validateSshAgentIdentities([{ identityId: "key-1", algorithm: "ssh-ed25519", publicKey: new Uint8Array([1]), fingerprint: "SHA256:fixture" }]).ok, true);
  assert.equal(validateSshAgentSignature({ algorithm: "ssh-ed25519", signature: new Uint8Array([2]) }).ok, true);
  assert.equal(validateSshAgentIdentities([{ identityId: "socket", algorithm: "ssh-ed25519", publicKey: new Uint8Array([1]), fingerprint: "x", socketPath: "/tmp/agent" }]).ok, false);
  assert.equal(validateSshAgentSignature({ algorithm: "ssh-rsa", signature: new Uint8Array([2]) }).ok, false);
});

test("conformance CLI validates package identity and exported entrypoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-extension-api-"));
  const packagePath = join(directory, "package.json");
  await writeFile(packagePath, JSON.stringify({
    name: "@example/fixture",
    version: "1.0.0",
    type: "module",
    exports: { ".": `./${validManifestFixture.entrypoint}` },
    terminay: validManifestFixture,
  }));
  const result = spawnSync(process.execPath, [resolve("dist/conformance.js"), packagePath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Valid Terminay extension/);
});
