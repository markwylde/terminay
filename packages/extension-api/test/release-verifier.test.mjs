import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { validManifestFixture } from "../dist/index.js";

async function makePackage(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "terminay-release-verifier-"));
  const packageJson = {
    name: "terminay-release-fixture",
    version: "1.0.0",
    type: "module",
    license: "MIT",
    exports: { ".": `./${validManifestFixture.entrypoint}` },
    terminay: validManifestFixture,
    ...overrides,
  };
  await writeFile(join(directory, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(join(directory, "package-lock.json"), `${JSON.stringify({ name: packageJson.name, version: packageJson.version, lockfileVersion: 3, requires: true, packages: { "": { name: packageJson.name, version: packageJson.version, license: "MIT" } } }, null, 2)}\n`);
  const entrypoint = join(directory, validManifestFixture.entrypoint);
  await mkdir(dirname(entrypoint), { recursive: true });
  await writeFile(entrypoint, "export default { activate() {} };\n");
  return directory;
}

test("release verifier emits reproducible inventory, SPDX, licenses, and compatibility evidence", async () => {
  const directory = await makePackage();
  const output = join(directory, "evidence-outside-pack");
  const result = spawnSync(process.execPath, [resolve("scripts/verify-release.mjs"), directory, "--output", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(await readFile(join(output, "extension-release-evidence.json"), "utf8"));
  assert.equal(evidence.package.name, "terminay-release-fixture");
  assert.equal(evidence.compatibility.api, validManifestFixture.api);
  assert.match(evidence.packed.sha256, /^[a-f0-9]{64}$/);
  assert.ok(evidence.packed.files.some((file) => file.path === "package.json"));
  const sbom = JSON.parse(await readFile(join(output, "sbom.spdx.json"), "utf8"));
  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.deepEqual(JSON.parse(await readFile(join(output, "third-party-licenses.json"), "utf8")), []);
});

test("release verifier rejects an unlocked package identity", async () => {
  const directory = await makePackage();
  const lockPath = join(directory, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.packages[""].version = "2.0.0";
  await writeFile(lockPath, JSON.stringify(lock));
  const result = spawnSync(process.execPath, [resolve("scripts/verify-release.mjs"), directory], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package-lock root must match/);
});
