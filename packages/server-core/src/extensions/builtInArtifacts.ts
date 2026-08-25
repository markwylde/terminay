import { createHash } from "node:crypto";
import { cp, lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { BuiltInExtensionArtifact, BuiltInExtensionArtifactSource } from "./installerTypes.js";

const INVENTORY_FILE = "inventory.v1.json";
const SHA256 = /^[a-f0-9]{64}$/u;
const INTEGRITY = /^(?:sha512|sha256)-[A-Za-z0-9+/=]+$/u;
const PACKAGE = /^(?:@[-a-z0-9._]+\/)?[-a-z0-9._]+$/iu;

/**
 * Reads release-produced extension artifacts from a host-owned directory.
 * This is intentionally a copy source, not a package installer: startup is
 * offline, and every file is checked against release inventory before it can
 * reach an extension slot.
 */
export class DirectoryBuiltInExtensionArtifactSource implements BuiltInExtensionArtifactSource {
  private inventory: readonly DirectoryArtifact[] | undefined;
  constructor(private readonly root: string) {
    if (!isAbsolute(root)) throw new TypeError("built-in extension artifact root must be absolute");
  }

  async list(_signal?: AbortSignal): Promise<readonly BuiltInExtensionArtifact[]> {
    const artifacts = await this.load();
    return Object.freeze(artifacts.map(({ artifact }) => artifact));
  }

  async materialize(artifact: BuiltInExtensionArtifact, stagingRoot: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    const record = (await this.load()).find((candidate) => sameArtifact(candidate.artifact, artifact));
    if (record === undefined) throw new Error("built-in extension artifact is not in the verified release inventory");
    await verifyTree(join(this.root, record.directory), record.files, signal);
    if (signal?.aborted) throw signal.reason;
    await cp(join(this.root, record.directory), stagingRoot, { recursive: true, dereference: false, errorOnExist: true });
  }

  private async load(): Promise<readonly DirectoryArtifact[]> {
    if (this.inventory !== undefined) return this.inventory;
    const raw = JSON.parse(await readFile(join(this.root, INVENTORY_FILE), "utf8")) as unknown;
    if (!record(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.artifacts) || raw.artifacts.length === 0 || raw.artifacts.length > 64) {
      throw new Error("built-in extension inventory is invalid");
    }
    const artifacts = raw.artifacts.map(parseArtifact);
    const ids = new Set(artifacts.map(({ artifact }) => artifact.extensionId));
    if (ids.size !== artifacts.length) throw new Error("built-in extension inventory has duplicate extension ids");
    this.inventory = Object.freeze(artifacts.sort((left, right) => left.artifact.extensionId.localeCompare(right.artifact.extensionId)));
    return this.inventory;
  }
}

interface DirectoryArtifact { readonly artifact: BuiltInExtensionArtifact; readonly directory: string; readonly files: readonly InventoryFile[]; }
interface InventoryFile { readonly path: string; readonly size: number; readonly sha256: string; }

function parseArtifact(value: unknown): DirectoryArtifact {
  if (!record(value) || typeof value.extensionId !== "string" || typeof value.packageName !== "string" || typeof value.version !== "string" || typeof value.integrity !== "string" || typeof value.directory !== "string" || typeof value.inventoryHash !== "string" || typeof value.lockHash !== "string" || !Array.isArray(value.files)) {
    throw new Error("built-in extension inventory artifact is invalid");
  }
  if (!PACKAGE.test(value.packageName) || !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(value.extensionId) || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value.version) || !INTEGRITY.test(value.integrity) || !SHA256.test(value.inventoryHash) || !SHA256.test(value.lockHash) || !safeRelative(value.directory)) {
    throw new Error("built-in extension inventory artifact is invalid");
  }
  const files = value.files.map(parseFile).sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0 || new Set(files.map((file) => file.path)).size !== files.length) throw new Error("built-in extension inventory file list is invalid");
  const manifestMetadata = value.manifestMetadata;
  if (!record(manifestMetadata)) throw new Error("built-in extension inventory manifest is invalid");
  const localDependencies = value.localDependencies === undefined ? [] : parseLocalDependencies(value.localDependencies);
  return Object.freeze({ artifact: Object.freeze({ extensionId: value.extensionId, packageName: value.packageName, version: value.version, integrity: value.integrity, source: "built-in", manifestMetadata, inventoryHash: value.inventoryHash, lockHash: value.lockHash, localDependencies, provenance: "verified" }), directory: value.directory, files: Object.freeze(files) });
}

function parseLocalDependencies(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 16 || value.some((item) => typeof item !== "string" || !PACKAGE.test(item))) throw new Error("built-in extension inventory local dependencies are invalid");
  if (new Set(value).size !== value.length || value.some((item) => item !== "@terminay/extension-api")) throw new Error("built-in extension inventory has an unapproved local dependency");
  return Object.freeze([...value]);
}

function parseFile(value: unknown): InventoryFile {
  if (!record(value) || typeof value.path !== "string" || !safeRelative(value.path) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 || typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) throw new Error("built-in extension inventory file is invalid");
  return Object.freeze({ path: value.path, size: value.size, sha256: value.sha256 });
}

async function verifyTree(root: string, expected: readonly InventoryFile[], signal?: AbortSignal): Promise<void> {
  const files: InventoryFile[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (signal?.aborted) throw signal.reason;
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      const info = await lstat(absolute);
      if (entry.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error("built-in extension artifact contains a non-regular entry");
      if (info.isDirectory()) await walk(absolute);
      else files.push(Object.freeze({ path, size: info.size, sha256: createHash("sha256").update(await readFile(absolute)).digest("hex") }));
    }
  }
  await walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error("built-in extension artifact differs from release inventory");
}

function sameArtifact(left: BuiltInExtensionArtifact, right: BuiltInExtensionArtifact): boolean {
  return left.extensionId === right.extensionId && left.packageName === right.packageName && left.version === right.version && left.integrity === right.integrity && left.inventoryHash === right.inventoryHash && left.lockHash === right.lockHash;
}
function safeRelative(value: string): boolean { return value.length > 0 && value.length <= 4096 && !value.includes("\0") && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === ".."); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
