import type { JsonValue } from "@terminay/protocol";
import { assertCompatibleVersions, CompatibilityError, type CompatibilityMatrix, type CompatibilityVersions } from "./compatibility.js";
import {
  MIGRATION_SCHEMA_VERSION,
  MigrationError,
  type LegacyMigrationSource,
  type MigrationBackend,
  type MigrationBackup,
  type MigrationRollbackResult,
  type MigrationRunResult,
  type MigrationStep,
} from "./types.js";

const STEPS: readonly MigrationStep[] = ["settings", "macros", "connectionProfiles", "projects", "recordings", "secrets"];

export interface MigrationRunnerOptions {
  readonly migrationId: string;
  readonly now?: () => number;
  readonly sourceSchemaVersion?: number;
  readonly expectedServerId?: string;
  /** Optional cross-surface version gate checked before backup/import. */
  readonly compatibilityRequirements?: CompatibilityMatrix;
}

/** Idempotent embedded import coordinator. Each step commits its marker after
 * success, so an interrupted import resumes without replaying completed work. */
export class MigrationRunner {
  private readonly now: () => number;
  private readonly options: MigrationRunnerOptions;

  constructor(private readonly backend: MigrationBackend, options: MigrationRunnerOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.migrationId)) throw new TypeError("migrationId is invalid");
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  async run(sourceInput: unknown): Promise<MigrationRunResult> {
    const source = validateSource(sourceInput);
    this.assertCompatibleSource(source);
    if (this.options.expectedServerId !== undefined && source.serverId !== undefined && source.serverId !== this.options.expectedServerId) {
      throw new MigrationError("identity_collision", "legacy source belongs to a different server identity");
    }
    const existing = await this.backend.loadMarker();
    if (existing?.status === "complete") return { marker: existing, resumed: true };
    const resumed = existing !== undefined;
    let marker = existing ?? {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      migrationId: this.options.migrationId,
      status: "pending" as const,
      completedSteps: [],
      startedAt: this.now(),
    };
    if (marker.migrationId !== this.options.migrationId) throw new MigrationError("invalid_source", "migration marker belongs to another migration");
    if (marker.schemaVersion !== MIGRATION_SCHEMA_VERSION) throw new MigrationError("invalid_source", "unsupported migration marker schema");
    if (marker.backupId === undefined) {
      const backup: MigrationBackup = {
        migrationId: this.options.migrationId,
        sourceSchemaVersion: this.options.sourceSchemaVersion ?? 0,
        redactedSource: redactSource(source),
      };
      const backupId = await this.backend.backup(backup);
      marker = { ...marker, status: "running", backupId, rollbackState: "available" };
      await this.backend.saveMarker(marker);
    } else if (marker.status === "pending") {
      marker = { ...marker, status: "running" };
      await this.backend.saveMarker(marker);
    }

    const completed = new Set(marker.completedSteps);
    for (const step of STEPS) {
      if (completed.has(step)) continue;
      try {
        await this.runStep(step, source);
      } catch (error) {
        const failure = error instanceof MigrationError
          ? error
          : new MigrationError("step_failed", `migration step failed: ${safeFailureMessage(error)}`, step, error);
        marker = { ...marker, status: "failed", failedStep: step, failureCode: failure.code, rollbackState: "available" };
        await this.backend.saveMarker(marker);
        throw failure;
      }
      completed.add(step);
      marker = {
        ...marker,
        status: "running",
        completedSteps: [...completed],
        failedStep: undefined,
        failureCode: undefined,
      };
      await this.backend.saveMarker(marker);
    }
    marker = { ...marker, status: "complete", completedSteps: STEPS, completedAt: this.now(), failedStep: undefined, failureCode: undefined, rollbackState: marker.backupId === undefined ? undefined : "available" };
    await this.backend.saveMarker(marker);
    return { marker, resumed };
  }

  private assertCompatibleSource(source: LegacyMigrationSource): void {
    const requirements = this.options.compatibilityRequirements;
    if (requirements === undefined) return;
    try {
      assertCompatibleVersions(readCompatibilityVersions(source), requirements);
    } catch (error) {
      if (error instanceof CompatibilityError) throw new MigrationError("incompatible_version", error.message, undefined, error);
      throw error;
    }
  }

  /**
   * Restore the opaque pre-import backup and reset only the progress marker.
   * Rollback is explicit: a backend without a restore boundary fails with a
   * typed error and leaves the failed marker intact for operator recovery.
   */
  async rollback(): Promise<MigrationRollbackResult> {
    const marker = await this.backend.loadMarker();
    if (marker === undefined || marker.backupId === undefined) {
      throw new MigrationError("rollback_unavailable", "migration backup is unavailable");
    }
    if (this.backend.restoreBackup === undefined) {
      throw new MigrationError("rollback_unavailable", "migration backend does not support rollback");
    }
    await this.backend.restoreBackup(marker.backupId);
    const reset: typeof marker = {
      ...marker,
      status: "pending",
      completedSteps: [],
      failedStep: undefined,
      failureCode: undefined,
      rollbackState: "restored",
      rollbackAt: this.now(),
      completedAt: undefined,
    };
    await this.backend.saveMarker(reset);
    return { marker: reset, restored: true };
  }

  private async runStep(step: MigrationStep, source: LegacyMigrationSource): Promise<void> {
    switch (step) {
      case "settings": return this.backend.importSettings(source.settings);
      case "macros": return this.backend.importMacros(source.macros);
      case "connectionProfiles": return this.backend.importConnectionProfiles(source.connectionProfiles);
      case "projects": return this.backend.importProjects(source.projects);
      case "recordings": return this.backend.importRecordings(source.recordings);
      case "secrets": {
        for (const [id, value] of Object.entries(source.secrets ?? {})) await this.backend.importSecret(id, value);
        return;
      }
    }
  }
}

function readCompatibilityVersions(source: LegacyMigrationSource): CompatibilityVersions {
  const input = source as Record<string, unknown>;
  const read = (...keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 128);
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return undefined;
  };
  return {
    desktop: read("desktopVersion", "sourceVersion", "version"),
    server: read("serverVersion"),
    ui: read("uiVersion", "bundleVersion"),
    bootstrap: read("bootstrapVersion"),
    signaling: read("signalingVersion", "protocolVersion"),
  };
}

function safeFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "migration step failed";
  // Preserve useful operational context without echoing credentials or long
  // provider/file payloads into the migration error surface.
  const sanitized = raw
    .replace(/(?:password|passphrase|secret|token|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, "$1: [redacted]")
    .replace(/\s+/gu, " ")
    .trim();
  return sanitized.slice(0, 256) || "migration step failed";
}

function validateSource(value: unknown): LegacyMigrationSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new MigrationError("invalid_source", "legacy migration source is not an object");
  const source = value as LegacyMigrationSource;
  if (source.serverId !== undefined && (typeof source.serverId !== "string" || source.serverId.length > 128)) throw new MigrationError("invalid_source", "legacy server identity is invalid");
  if (source.secrets !== undefined && (typeof source.secrets !== "object" || source.secrets === null || Array.isArray(source.secrets))) throw new MigrationError("invalid_source", "legacy secrets are invalid");
  return source;
}

function redactSource(source: LegacyMigrationSource): JsonValue {
  return redactValue(source) as JsonValue;
}

function redactValue(value: unknown, key?: string): JsonValue {
  if (key !== undefined && isSecretKey(key)) return "[redacted]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(childKey)) continue;
      result[childKey] = redactValue(childValue, childKey);
    }
    return result;
  }
  return null;
}

function isSecretKey(key: string): boolean {
  return /(?:secret|token|password|passphrase|credential|privatekey|api[_-]?key|pairing|grant|proof)/iu.test(key);
}
