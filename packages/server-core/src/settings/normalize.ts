import type { JsonValue } from "@terminay/protocol";
import { DEFAULT_SERVER_SETTINGS, isJsonValue } from "./defaults.js";
import { classifySetting, isServerSettingPath, partitionSettings } from "./classification.js";
import {
  SETTINGS_SCHEMA_VERSION,
  cloneSettings,
  isSettingsObject,
  type SecretReference,
  type SecretReferenceMap,
  type ServerSettingsState,
  type SettingsObject,
} from "./types.js";

const MAX_STRING = 16_384;
const SECRET_KEY = /(?:secret|token|password|passphrase|credential|privatekey|api[_-]?key|plaintext|pairingpinhash)/i;

export interface NormalizedSettings {
  readonly settings: SettingsObject;
  readonly secretReferences: SecretReferenceMap;
}

export function normalizeServerSettings(input: unknown): SettingsObject {
  return normalizeSettingsAndSecrets(input).settings;
}

export function normalizeSettingsAndSecrets(input: unknown): NormalizedSettings {
  const raw = unwrapSettings(input);
  const partitioned = partitionSettings(raw);
  const settings = mergeKnownDefaults(DEFAULT_SERVER_SETTINGS, partitioned.server);
  const references = collectSecretReferences(input, raw);
  return { settings, secretReferences: references };
}

/** Idempotent migration for old Electron JSON and revisioned server snapshots. */
export function migrateServerSettings(input: unknown): ServerSettingsState {
  const source = isSettingsObject(input) ? input : {};
  const rawRevision = source.revision;
  const revision = Number.isSafeInteger(rawRevision) && (rawRevision as number) >= 0 ? (rawRevision as number) : 0;
  const normalized = normalizeSettingsAndSecrets(input);
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision,
    cursor: String(revision),
    settings: normalized.settings,
    secretReferences: normalized.secretReferences,
  };
}

export function createInitialServerSettings(): ServerSettingsState {
  return migrateServerSettings(undefined);
}

export function normalizeSecretReference(id: string, raw: unknown): SecretReference {
  const safeId = normalizeId(id);
  const object = isSettingsObject(raw) ? raw : {};
  const configured =
    (typeof raw === "string" && raw.length > 0) ||
    object.configured === true ||
    Object.keys(object).some((key) => SECRET_KEY.test(key));
  const result: { id: string; configured: boolean; label?: string; version?: number; updatedAt?: number } = {
    id: safeId,
    configured,
  };
  if (typeof object.label === "string" && object.label.length <= 256) result.label = object.label;
  if (Number.isSafeInteger(object.version) && (object.version as number) >= 0) result.version = object.version as number;
  if (Number.isSafeInteger(object.updatedAt) && (object.updatedAt as number) >= 0) result.updatedAt = object.updatedAt as number;
  return result;
}

export function normalizeSecretReferences(input: unknown): SecretReferenceMap {
  if (!isSettingsObject(input)) return {};
  const output: Record<string, SecretReference> = {};
  for (const [id, raw] of Object.entries(input)) {
    const ref = normalizeSecretReference(id, raw);
    output[ref.id] = ref;
  }
  return output;
}

function unwrapSettings(input: unknown): SettingsObject {
  if (!isSettingsObject(input)) return {};
  if (isSettingsObject(input.settings)) return input.settings;
  if (isSettingsObject(input.values)) return input.values;
  // A v0 file was the settings object itself. Metadata keys are ignored by
  // partitionSettings and therefore cannot become server settings.
  return input;
}

function collectSecretReferences(input: unknown, rawSettings: SettingsObject): SecretReferenceMap {
  const output: Record<string, SecretReference> = {};
  if (isSettingsObject(input)) {
    for (const key of ["secretReferences", "secrets", "vaultReferences"]) {
      const refs = input[key];
      if (isSettingsObject(refs)) Object.assign(output, normalizeSecretReferences(refs));
    }
  }
  for (const [key, value] of Object.entries(rawSettings)) collectSuspiciousSecrets(output, key, value, key);
  return output;
}

function collectSuspiciousSecrets(output: Record<string, SecretReference>, key: string, value: unknown, path: string): void {
  if (SECRET_KEY.test(key)) {
    output[path] = normalizeSecretReference(path, value);
    return;
  }
  if (!isSettingsObject(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) collectSuspiciousSecrets(output, childKey, childValue, `${path}.${childKey}`);
}

function mergeKnownDefaults(defaults: SettingsObject, candidate: SettingsObject): SettingsObject {
  const result: Record<string, JsonValue> = cloneSettings(defaults);
  for (const [key, value] of Object.entries(candidate)) {
    if (!isServerSettingPath(key)) continue;
    const fallback = result[key];
    result[key] = normalizeValue(value, fallback, key);
  }
  return result;
}

function normalizeValue(value: unknown, fallback: JsonValue | undefined, path: string): JsonValue {
  if (value === undefined || !isJsonValue(value)) return fallback ?? null;
  if (typeof fallback === "string") return typeof value === "string" && value.length <= MAX_STRING ? value : fallback;
  if (typeof fallback === "boolean") return typeof value === "boolean" ? value : fallback;
  if (typeof fallback === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return boundedNumber(path, value);
  }
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
  if (isSettingsObject(fallback)) {
    if (!isSettingsObject(value)) return fallback;
    const result: Record<string, JsonValue> = cloneSettings(fallback);
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      const childPath = `${path}.${key}`;
      if (classifySetting(childPath) === "device-override") continue;
      result[key] = normalizeValue(child, result[key], childPath);
    }
    return result;
  }
  return fallback ?? null;
}

function boundedNumber(path: string, value: number): number {
  const limits: Array<[string, number, number]> = [
    ["pinFailureLimit", 1, 100],
    ["scrollback", 0, 1_000_000],
    ["maxSteps", 1, 4096],
    ["maxFields", 1, 256],
    ["maxOutputBytes", 1024, 16_777_216],
    ["maxDelayMs", 0, 86_400_000],
    ["maxConcurrentRuns", 1, 32],
    ["silenceStopSeconds", 0, 3600],
    ["maxDurationSeconds", 1, 86_400],
  ];
  const limit = limits.find(([name]) => path.endsWith(name));
  if (limit === undefined) return value;
  return Math.min(limit[2], Math.max(limit[1], value));
}

function normalizeId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) return "secret:unknown";
  return normalized;
}
