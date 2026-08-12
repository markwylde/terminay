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
  validateDeclarativeForm,
  validateExtensionManifest,
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
