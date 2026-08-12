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
  validateValidationIssues,
} from "../dist/index.js";

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

test("declarative form fixture validates and executable UI is rejected", () => {
  assert.equal(validateDeclarativeForm(validFormFixture).ok, true);
  const result = validateDeclarativeForm({ ...validFormFixture, html: "<script />" });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "unknown_field"));
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
