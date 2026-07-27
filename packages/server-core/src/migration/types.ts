import type { JsonValue, ProtocolId } from "@terminay/protocol";

export const MIGRATION_SCHEMA_VERSION = 1;

export type MigrationStep = "settings" | "macros" | "connectionProfiles" | "projects" | "recordings" | "secrets";
export type MigrationStatus = "pending" | "running" | "failed" | "complete";
export type MigrationRollbackState = "available" | "restored";

/** The marker contains progress only; it deliberately never contains source
 * settings, paths, credentials, or any other user payload. */
export interface MigrationMarker {
  readonly schemaVersion: number;
  readonly migrationId: ProtocolId;
  readonly status: MigrationStatus;
  readonly completedSteps: readonly MigrationStep[];
  readonly backupId?: ProtocolId;
  readonly failedStep?: MigrationStep;
  readonly failureCode?: string;
  /** A failed marker keeps the pre-import backup actionable for explicit
   * rollback; this state never contains source payloads. */
  readonly rollbackState?: MigrationRollbackState;
  readonly rollbackAt?: number;
  readonly startedAt: number;
  readonly completedAt?: number;
}

export interface LegacyMigrationSource {
  readonly serverId?: string;
  readonly settings?: JsonValue;
  readonly macros?: JsonValue;
  readonly connectionProfiles?: JsonValue;
  readonly projects?: JsonValue;
  readonly recordings?: JsonValue;
  readonly secrets?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface MigrationBackup {
  readonly migrationId: ProtocolId;
  readonly sourceSchemaVersion: number;
  /** Sanitized metadata only. Secret values and credential-like keys are absent. */
  readonly redactedSource: JsonValue;
}

export interface MigrationBackend {
  loadMarker(): Promise<MigrationMarker | undefined>;
  saveMarker(marker: MigrationMarker): Promise<void>;
  backup(source: MigrationBackup): Promise<ProtocolId>;
  /** Restore the opaque pre-import backup before a retry. Optional backends
   * may expose recovery instructions without performing an automatic restore. */
  restoreBackup?(backupId: ProtocolId): Promise<void>;
  importSettings(value: JsonValue | undefined): Promise<void>;
  importMacros(value: JsonValue | undefined): Promise<void>;
  importConnectionProfiles(value: JsonValue | undefined): Promise<void>;
  importProjects(value: JsonValue | undefined): Promise<void>;
  importRecordings(value: JsonValue | undefined): Promise<void>;
  /** This callback is the privileged vault boundary. The runner never logs,
   * serializes, or places the value in a marker/backup. */
  importSecret(id: string, value: unknown): Promise<void>;
}

export interface MigrationRunResult {
  readonly marker: MigrationMarker;
  readonly resumed: boolean;
}

export interface MigrationRollbackResult {
  readonly marker: MigrationMarker;
  readonly restored: true;
}

export class MigrationError extends Error {
  readonly code: "invalid_source" | "identity_collision" | "step_failed" | "rollback_unavailable" | "incompatible_version";
  readonly step?: MigrationStep;

  constructor(code: MigrationError["code"], message: string, step?: MigrationStep, cause?: unknown) {
    super(message, { cause });
    this.name = "MigrationError";
    this.code = code;
    if (step !== undefined) this.step = step;
  }
}
