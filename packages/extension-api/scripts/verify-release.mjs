#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateExtensionManifest } from "../dist/index.js";

const packageDirectory = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".");
const outputFlag = process.argv.indexOf("--output");
const outputDirectory = resolve(outputFlag >= 0 ? process.argv[outputFlag + 1] : join(packageDirectory, "release-evidence"));

function fail(message) {
  throw new Error(message);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function licenseOf(record) {
  if (typeof record.license === "string" && record.license.trim()) return record.license.trim();
  if (Array.isArray(record.licenses) && record.licenses.every((value) => typeof value === "string")) return record.licenses.join(" OR ");
  if (Array.isArray(record.licenses) && record.licenses.every((value) => value && typeof value === "object" && typeof value.type === "string")) return record.licenses.map((value) => value.type.trim()).join(" OR ");
  return undefined;
}

function dependencyName(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) : basename(path);
}

function assertRegistryDependencies(packageJson) {
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const unsupported = /^(?:file:|git(?:\+[^:]+)?:|https?:|github:|workspace:|link:|npm:|\.\.?\/|\/)/i;
  for (const section of sections) {
    for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
      if (typeof spec !== "string" || unsupported.test(spec.trim()) || spec.includes("#")) fail(`${section} ${name} must use a registry semver specifier`);
    }
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(packageDirectory, "package-lock.json"), "utf8"));
  const manifestResult = validateExtensionManifest(packageJson.terminay);
  if (!manifestResult.ok) fail(`invalid Terminay manifest: ${manifestResult.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  if (lock.lockfileVersion !== 3) fail("package-lock.json must use lockfileVersion 3");
  assertRegistryDependencies(packageJson);
  const root = lock.packages?.[""];
  if (!root || root.name !== packageJson.name || root.version !== packageJson.version) fail("package-lock root must match the exact package name and version");

  const components = [];
  for (const [path, record] of Object.entries(lock.packages ?? {})) {
    if (!record || path === "" || record.link || record.dev) continue;
    const name = record.name ?? dependencyName(path);
    if (!record.version || !record.integrity) fail(`production dependency ${name} must have exact version and integrity`);
    let license = licenseOf(record);
    if (!license) {
      try {
        const installed = JSON.parse(await readFile(join(packageDirectory, path, "package.json"), "utf8"));
        if (installed.name !== name || installed.version !== record.version) fail(`installed metadata for ${name}@${record.version} does not match the lock`);
        license = licenseOf(installed);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("installed metadata")) throw error;
      }
    }
    if (!license) fail(`production dependency ${name}@${record.version} has no declared license`);
    components.push({ name, version: record.version, license, integrity: record.integrity });
  }
  components.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

  const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  run(process.execPath, [join(apiRoot, "dist/conformance.js"), join(packageDirectory, "package.json")], packageDirectory);
  const dryRun = firstPackResult(JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], packageDirectory)));
  if (!dryRun?.files?.length) fail("npm pack returned an empty inventory");

  const first = await mkdtemp(join(tmpdir(), "terminay-extension-pack-a-"));
  const second = await mkdtemp(join(tmpdir(), "terminay-extension-pack-b-"));
  try {
    const firstPack = firstPackResult(JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", first], packageDirectory)));
    const secondPack = firstPackResult(JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", second], packageDirectory)));
    const firstBytes = await readFile(join(first, firstPack.filename));
    const secondBytes = await readFile(join(second, secondPack.filename));
    if (sha256(firstBytes) !== sha256(secondBytes)) fail("two clean npm pack runs produced different bytes");

    await mkdir(outputDirectory, { recursive: true });
    const inventory = dryRun.files.map(({ path, size }) => ({ path, size })).sort((a, b) => a.path.localeCompare(b.path));
    const evidence = {
      schemaVersion: 1,
      package: { name: packageJson.name, version: packageJson.version },
      compatibility: { api: manifestResult.value.api, terminay: manifestResult.value.engines.terminay, node: manifestResult.value.engines.node },
      permissions: manifestResult.value.permissions,
      packed: { filename: firstPack.filename, sha256: sha256(firstBytes), integrity: firstPack.integrity, shasum: firstPack.shasum, files: inventory },
      inputs: { packageJsonSha256: sha256(await readFile(join(packageDirectory, "package.json"))), packageLockSha256: sha256(await readFile(join(packageDirectory, "package-lock.json"))), node: process.version, npm: run("npm", ["--version"], packageDirectory).trim() },
    };
    const sbom = { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: `${packageJson.name}-${packageJson.version}`, documentNamespace: `https://terminay.dev/sbom/${encodeURIComponent(packageJson.name)}/${packageJson.version}/${evidence.packed.sha256}`, creationInfo: { creators: ["Tool: @terminay/extension-api verify-release"] }, packages: [{ SPDXID: "SPDXRef-Root", name: packageJson.name, versionInfo: packageJson.version, licenseDeclared: packageJson.license ?? "NOASSERTION" }, ...components.map((component, index) => ({ SPDXID: `SPDXRef-Dependency-${index + 1}`, name: component.name, versionInfo: component.version, licenseDeclared: component.license, checksums: [{ algorithm: "SHA512", checksumValue: component.integrity.replace(/^sha512-/, "") }] }))] };
    await Promise.all([
      writeFile(join(outputDirectory, "extension-release-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`),
      writeFile(join(outputDirectory, "sbom.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`),
      writeFile(join(outputDirectory, "third-party-licenses.json"), `${JSON.stringify(components, null, 2)}\n`),
      writeFile(join(outputDirectory, firstPack.filename), firstBytes),
    ]);
    process.stdout.write(`Verified reproducible extension package ${packageJson.name}@${packageJson.version} (${evidence.packed.sha256})\n`);
  } finally {
    await Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]);
  }
}

function firstPackResult(value) {
  const results = Array.isArray(value) ? value : Object.values(value ?? {});
  if (results.length !== 1) fail("npm pack must return exactly one package");
  return results[0];
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Release verification failed"}\n`);
  process.exitCode = 1;
});
