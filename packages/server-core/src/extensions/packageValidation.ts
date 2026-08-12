import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertManifestMatchesPackage, parseExtensionManifest, type TerminayExtensionManifest } from "@terminay/extension-api";
import type { RegistryPackageResolution } from "./installerTypes.js";

const MAX_FILES = 20_000;
const MAX_BYTES = 256 * 1024 * 1024;
const INSTALL_SCRIPTS = new Set(["preinstall", "install", "postinstall"]);

export interface ValidatedExtensionTree {
  readonly packageRoot: string;
  readonly manifest: TerminayExtensionManifest;
  readonly lockHash: string;
  readonly inventoryHash: string;
}

export async function validateMaterializedExtension(stagingRoot: string, resolution: RegistryPackageResolution): Promise<ValidatedExtensionTree> {
  const lockBytes = await readFile(join(stagingRoot, "package-lock.json"));
  const lock = parseObject(lockBytes, "package-lock.json");
  validateNpmLockfile(lock, resolution);
  const packageRoot = join(stagingRoot, "node_modules", ...resolution.packageName.split("/"));
  const canonicalStaging = await realpath(stagingRoot);
  const canonicalPackage = await realpath(packageRoot);
  if (outside(canonicalStaging, canonicalPackage)) throw new Error("extension package root escapes staging slot");
  const packageJson = parseObject(await readFile(join(packageRoot, "package.json")), "extension package.json");
  if (packageJson.name !== resolution.packageName || packageJson.version !== resolution.version) throw new Error("materialized package identity differs from preview");
  const manifest = parseExtensionManifest(packageJson.terminay);
  assertManifestMatchesPackage(manifest, packageJson);
  const inventory = await inventoryTree(stagingRoot);
  return Object.freeze({ packageRoot, manifest, lockHash: sha256(lockBytes), inventoryHash: sha256(JSON.stringify(inventory)) });
}

/** Validate the complete resolved closure before npm is allowed to materialize
 * any package content or invoke package tooling. */
export function validateNpmLockfile(lock: unknown, resolution: RegistryPackageResolution): void {
  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) throw new Error("exact npm lockfile v3 is required");
  const lockRecord = lock as Record<string, unknown>;
  if (lockRecord.lockfileVersion !== 3 || typeof lockRecord.packages !== "object" || lockRecord.packages === null || Array.isArray(lockRecord.packages)) throw new Error("exact npm lockfile v3 is required");
  const packages = lockRecord.packages as Record<string, unknown>;
  const target = packages[`node_modules/${resolution.packageName}`];
  if (typeof target !== "object" || target === null || (target as Record<string, unknown>).version !== resolution.version || (target as Record<string, unknown>).integrity !== resolution.integrity) throw new Error("lockfile does not bind the confirmed package integrity");
  for (const [path, value] of Object.entries(packages)) {
    if (path === "") continue;
    if (!path.startsWith("node_modules/") || typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("lockfile contains an invalid package record");
    const record = value as Record<string, unknown>;
    if (typeof record.integrity !== "string" || record.integrity.length < 20) throw new Error("every dependency requires registry integrity");
    if (typeof record.resolved === "string" && !record.resolved.startsWith("https://registry.npmjs.org/")) throw new Error("dependency did not resolve from public npmjs");
    if (record.link === true) throw new Error("linked dependencies are unsupported");
    const scripts = record.hasInstallScript;
    if (scripts === true) throw new Error("install-script-dependent packages are unsupported");
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = record[field];
      if (typeof dependencies === "object" && dependencies !== null && !Array.isArray(dependencies)) {
        for (const spec of Object.values(dependencies)) if (typeof spec !== "string" || /^(?:git|https?|file|link|npm|workspace):/iu.test(spec)) throw new Error("non-registry dependency specifications are unsupported");
      }
    }
  }
}

async function inventoryTree(root: string): Promise<readonly { path: string; size: number; hash: string }[]> {
  const output: { path: string; size: number; hash: string }[] = [];
  let bytes = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error("extension trees cannot contain symbolic links");
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!entry.isFile()) throw new Error("extension trees can contain regular files only");
      if (relativePath.endsWith(".node") || relativePath.endsWith("/binding.gyp") || relativePath === "binding.gyp") throw new Error("native extension dependencies are unsupported");
      const contents = await readFile(absolute);
      bytes += contents.byteLength;
      output.push({ path: relativePath, size: contents.byteLength, hash: sha256(contents) });
      if (output.length > MAX_FILES || bytes > MAX_BYTES) throw new Error("extension package tree exceeds v1 limits");
      if (relativePath.endsWith("package.json")) {
        const json = parseObject(contents, relativePath);
        if (typeof json.scripts === "object" && json.scripts !== null && Object.keys(json.scripts).some((name) => INSTALL_SCRIPTS.has(name))) throw new Error("install lifecycle scripts are unsupported");
      }
    }
  }
  await walk(root);
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

function parseObject(bytes: Uint8Array, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new Error(`${label} is not valid JSON`); }
}
function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function outside(root: string, candidate: string): boolean { const value = relative(root, resolve(candidate)); return value === "" ? false : value.startsWith("..") || isAbsolute(value); }
