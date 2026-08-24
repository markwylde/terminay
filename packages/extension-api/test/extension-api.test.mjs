import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  EXTENSION_EVENT_NAMES,
  EXTENSION_OPERATION_NAMES,
  OPERATION_POLICIES,
  hostileManifestFixtures,
  namespacedId,
  validFormFixture,
  validManifestFixture,
  validProviderDefinitionFixture,
  validateDeclarativeForm,
  validateEnvironmentActionResult,
  validateExtensionManifest,
  validateOptionSourceResult,
  validateProgressPresentation,
  validateProviderDefinition,
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

test("SSH agent access is an explicit supported manifest permission", () => {
  const result = validateExtensionManifest({ ...validManifestFixture, permissions: ["network", "ssh-agent:use"] });
  assert.equal(result.ok, true);
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
