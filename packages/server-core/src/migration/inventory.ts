import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MIGRATION_SCHEMA_VERSION, type LegacyMigrationSource } from "./types.js";

/** A path is retained as a reference during migration; the migration never
 * copies or retargets the user's project/recording files implicitly. */
export type MigrationPathKind = "project" | "recording";
export type MigrationPathState = "available" | "missing" | "inaccessible" | "invalid";

export interface MigrationPathReference {
  readonly kind: MigrationPathKind;
  readonly path: string;
  readonly state: MigrationPathState;
  readonly preservedInPlace: true;
  /** A stable, user-actionable reason that does not echo filesystem errors. */
  readonly reason?: "not-found" | "permission-denied" | "not-absolute" | "invalid";
}

export interface MigrationStoreInventory {
  readonly name:
    | "settings"
    | "macros"
    | "safeStorageSecrets"
    | "remoteDevices"
    | "auditRecords"
    | "tlsPaths"
    | "connectionProfiles"
    | "projects"
    | "recordings";
  readonly present: boolean;
  /** Only a bounded count is reported. Values are never copied into inventory. */
  readonly entries: number;
}

/** Version evidence is metadata-only: values from the legacy store are never
 * copied into a migration preflight report. */
export type MigrationStoreFormat = "missing" | "legacy" | "versioned";

export interface MigrationStoreVersion {
  readonly name: MigrationStoreInventory["name"];
  readonly format: MigrationStoreFormat;
  readonly schemaVersion: number | null;
  readonly version: string | null;
}

export interface MigrationInventory {
  readonly sourceSchemaVersion: number;
  readonly destinationSchemaVersion: number;
  readonly sourceVersion: string | null;
  readonly stores: readonly MigrationStoreInventory[];
  /** Per-store version evidence for supported legacy Desktop layouts. */
  readonly storeVersions: readonly MigrationStoreVersion[];
  readonly projectPaths: readonly MigrationPathReference[];
  readonly recordingPaths: readonly MigrationPathReference[];
  /** Renderer-only layouts were never canonical state and cannot be recovered. */
  readonly rendererLayout: {
    readonly recoverable: false;
    readonly reason: "renderer-only-layout-not-persisted";
  };
}

export interface MigrationInventoryOptions {
  readonly sourceSchemaVersion?: number;
  readonly maxPathReferences?: number;
  readonly pathProbe?: (path: string) => MigrationPathState | Promise<MigrationPathState>;
}

const DEFAULT_MAX_PATH_REFERENCES = 128;
const ABSOLUTE_WINDOWS_PATH = /^[A-Za-z]:[\\/]/u;
const UNC_PATH = /^\\\\/u;
const PATH_KEYS = new Set([
  "path",
  "root",
  "rootPath",
  "projectPath",
  "projectRoot",
  "recordingPath",
  "recordingRoot",
  "directory",
  "filePath",
  "castPath",
]);

const STORE_KEYS = [
  ["settings", ["settings", "preferences", "config"]],
  ["macros", ["macros", "macroDefinitions", "quickCommands"]],
  ["safeStorageSecrets", ["safeStorage", "safeStorageSecrets", "secrets"]],
  ["remoteDevices", ["remoteDevices", "devices", "deviceGrants", "deviceKeys"]],
  ["auditRecords", ["auditRecords", "audit", "auditLog"]],
  ["tlsPaths", ["tlsPaths", "tls", "tlsConfig"]],
  ["connectionProfiles", ["connectionProfiles", "profiles", "connections"]],
  ["projects", ["projects", "projectRoots"]],
  ["recordings", ["recordings", "recordingRoots"]],
] as const;

/**
 * Build a bounded, metadata-only inventory before an embedded import.
 *
 * This is intentionally separate from MigrationRunner: hosts can show a
 * preflight report and ask the user to repair a missing project/recording root
 * without starting a settings, vault, or remote-device import.
 */
export async function inspectLegacyMigration(sourceInput: unknown, options: MigrationInventoryOptions = {}): Promise<MigrationInventory> {
  const source = validateInventorySource(sourceInput);
  const maxPathReferences = boundedPathLimit(options.maxPathReferences);
  const sourceSchemaVersion = validSchemaVersion(options.sourceSchemaVersion) ? options.sourceSchemaVersion! : 0;
  const sourceVersion = readSourceVersion(source);
  const pathProbe = options.pathProbe ?? probePath;

  const projectCandidates = collectPathCandidates(source.projects, maxPathReferences);
  const recordingCandidates = collectPathCandidates(source.recordings, maxPathReferences);
  const projectPaths = await inspectPaths(projectCandidates, "project", pathProbe);
  const recordingPaths = await inspectPaths(recordingCandidates, "recording", pathProbe);

  return {
    sourceSchemaVersion,
    destinationSchemaVersion: MIGRATION_SCHEMA_VERSION,
    sourceVersion,
    stores: STORE_KEYS.map(([name, keys]) => summarizeStore(name, source, keys)),
    storeVersions: STORE_KEYS.map(([name, keys]) => summarizeStoreVersion(name, source, keys)),
    projectPaths,
    recordingPaths,
    rendererLayout: {
      recoverable: false,
      reason: "renderer-only-layout-not-persisted",
    },
  };
}

function validateInventorySource(value: unknown): LegacyMigrationSource & Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("legacy migration source is not an object");
  return value as LegacyMigrationSource & Record<string, unknown>;
}

function validSchemaVersion(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff;
}

function boundedPathLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_PATH_REFERENCES;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1024) throw new RangeError("maxPathReferences must be between 1 and 1024");
  return value;
}

function readSourceVersion(source: Record<string, unknown>): string | null {
  for (const key of ["sourceVersion", "desktopVersion", "version"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 64);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function summarizeStore(name: MigrationStoreInventory["name"], source: Record<string, unknown>, keys: readonly string[]): MigrationStoreInventory {
  const key = keys.find((candidate) => source[candidate] !== undefined);
  const value = key === undefined ? undefined : source[key];
  return {
    name,
    present: value !== undefined,
    entries: boundedEntryCount(value),
  };
}

function summarizeStoreVersion(name: MigrationStoreInventory["name"], source: Record<string, unknown>, keys: readonly string[]): MigrationStoreVersion {
  const key = keys.find((candidate) => source[candidate] !== undefined);
  if (key === undefined) return { name, format: "missing", schemaVersion: null, version: null };
  const value = source[key];
  const record = isRecord(value) ? value : undefined;
  const schemaVersion = readBoundedVersion(record?.schemaVersion);
  const version = readVersionString(record?.version ?? record?.sourceVersion ?? record?.desktopVersion);
  return {
    name,
    format: schemaVersion !== null || version !== null ? "versioned" : "legacy",
    schemaVersion,
    version,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedVersion(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff ? value as number : null;
}

function readVersionString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, 64);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 64) : null;
}

function boundedEntryCount(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value)) return Math.min(value.length, 1024);
  if (typeof value === "object") return Math.min(Object.keys(value as Record<string, unknown>).length, 1024);
  return 1;
}

function collectPathCandidates(value: unknown, limit: number): readonly string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const visit = (current: unknown, depth: number, key?: string): void => {
    if (paths.length >= limit || depth > 5) return;
    if (typeof current === "string") {
      if (key === undefined || PATH_KEYS.has(key)) add(current);
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    for (const [childKey, childValue] of Object.entries(current as Record<string, unknown>)) {
      if (PATH_KEYS.has(childKey)) visit(childValue, depth + 1, childKey);
      else if (typeof childValue === "object" && childValue !== null) visit(childValue, depth + 1, childKey);
    }
  };
  const add = (path: string): void => {
    if (paths.length >= limit || path.length > 4096 || path.includes("\0") || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };
  visit(value, 0);
  return paths;
}

async function inspectPaths(paths: readonly string[], kind: MigrationPathKind, pathProbe: (path: string) => MigrationPathState | Promise<MigrationPathState>): Promise<readonly MigrationPathReference[]> {
  const result: MigrationPathReference[] = [];
  for (const path of paths) {
    const state = isAbsoluteLegacyPath(path) ? await pathProbe(path) : "invalid";
    result.push({
      kind,
      path,
      state,
      preservedInPlace: true,
      reason: pathReason(path, state),
    });
  }
  return result;
}

function pathReason(path: string, state: MigrationPathState): MigrationPathReference["reason"] {
  if (state === "missing") return "not-found";
  if (state === "inaccessible") return "permission-denied";
  if (state === "invalid") return isAbsoluteLegacyPath(path) ? "invalid" : "not-absolute";
  return undefined;
}

async function probePath(path: string): Promise<MigrationPathState> {
  if (!isAbsoluteLegacyPath(path)) return "invalid";
  try {
    const metadata = await stat(path);
    return metadata.isFile() || metadata.isDirectory() ? "available" : "invalid";
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { readonly code?: unknown }).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    if (code === "EACCES" || code === "EPERM") return "inaccessible";
    return "missing";
  }
}

function isAbsoluteLegacyPath(value: string): boolean {
  return isAbsolute(value) || ABSOLUTE_WINDOWS_PATH.test(value) || UNC_PATH.test(value);
}
