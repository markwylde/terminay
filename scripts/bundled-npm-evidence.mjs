import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const repositoryRoot = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, repositoryRoot), "utf8"));

/** Deterministic SBOM/license/integrity evidence for every package npm declares
 * in its bundled production closure. No package code is executed. */
export async function inspectBundledNpmEvidence() {
  const [npmPackage, lock] = await Promise.all([readJson("node_modules/npm/package.json"), readJson("package-lock.json")]);
  if (npmPackage.version !== "12.0.2") throw new Error("bundled npm version is not pinned to 12.0.2");
  const npmLock = lock.packages["node_modules/npm"];
  if (typeof npmLock?.integrity !== "string") throw new Error("bundled npm archive lacks registry integrity");
  const names = ["npm", ...(npmPackage.bundleDependencies ?? [])].sort();
  const packages = await Promise.all(names.map(async (name) => {
    const direct = lock.packages[`node_modules/${name}`]; const bundled = lock.packages[`node_modules/npm/node_modules/${name}`]; const record = name === "npm" ? npmLock : bundled ?? direct;
    if (record === undefined || typeof record.version !== "string") throw new Error(`bundled npm closure lacks version evidence for ${name}`);
    const installed = name === "npm" ? npmPackage : await readJson(`node_modules/npm/node_modules/${name}/package.json`);
    const declaredLicense = typeof record.license === "string" ? record.license : installed.license;
    const license = typeof declaredLicense === "string" ? declaredLicense : "NOASSERTION";
    const integrity = typeof record.integrity === "string" ? record.integrity : npmLock.integrity;
    return { name, version: record.version, integrity, integritySource: typeof record.integrity === "string" ? "package" : "npm-bundle", license, licenseDeclared: license !== "NOASSERTION" };
  }));
  const inventory = JSON.stringify(packages);
  return { schemaVersion: 1, component: "npm", version: npmPackage.version, packageCount: packages.length, closureSha256: createHash("sha256").update(inventory).digest("hex"), packages };
}

export async function writeBundledNpmEvidence(outputPath) {
  const evidence = await inspectBundledNpmEvidence(); await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`); return evidence;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = process.argv[2]; if (!output) throw new Error("usage: bundled-npm-evidence.mjs <output>");
  await writeBundledNpmEvidence(resolve(output));
}
