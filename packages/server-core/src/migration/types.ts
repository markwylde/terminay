import type { JsonValue, ProtocolId } from "@terminay/protocol";

export const MIGRATION_SCHEMA_VERSION = 1;

export type MigrationStep = "settings" | "macros" | "connectionProfiles" | "projects" | "recordings" | "secrets";
export type MigrationStatus = "pending" | "running" | "failed" | "complete";
export type MigrationRollbackState = "available" | "restored" | "recovery-required";
/** The server-only commit is the point after which Electron presentation state
 * must not be restored implicitly. Backends that stage server writes should
 * implement `commitServerOnlyMutations` as that transaction boundary. */
export type MigrationServerCommitState = "uncommitted" | "committed" | "unknown";

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
  readonly electronStateBackupId?: ProtocolId;
  readonly serverCommitState?: MigrationServerCommitState;
  readonly serverCommitAt?: number;
  readonly backupRecoveryAt?: number;
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
  /** Capture the privileged pre-migration Electron state as an opaque backup
   * reference. The runner never serializes the captured state. */
  captureElectronState?(): Promise<ProtocolId>;
  /** Restore Electron state only while server-only mutations are uncommitted. */
  restoreElectronState?(backupId: ProtocolId): Promise<void>;
  /** Commit staged server-only mutations. This is the irreversible boundary
   * for automatic Electron rollback. */
  beginServerOnlyMutations?(): Promise<void>;
  commitServerOnlyMutations?(): Promise<void>;
  /** Discard staged server mutations when failure occurs before commit. */
  rollbackServerOnlyMutations?(): Promise<void>;
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
  readonly restored: boolean;
  readonly electronRestored: boolean;
  readonly serverOnlyCommitted: boolean;
  readonly backupRecoveryRequired: boolean;
}

export interface MigrationBackupRecoveryResult {
  readonly marker: MigrationMarker;
  readonly recovered: true;
  readonly serverRestored: true;
  /** Electron state is deliberately not restored after the commit boundary. */
  readonly electronRestored: false;
  readonly electronStateBackupId?: ProtocolId;
}

export class MigrationError extends Error {
  readonly code: "invalid_source" | "identity_collision" | "step_failed" | "rollback_unavailable" | "rollback_requires_backup_recovery" | "backup_recovery_unavailable" | "incompatible_version";
  readonly step?: MigrationStep;

  constructor(code: MigrationError["code"], message: string, step?: MigrationStep, cause?: unknown) {
    super(message, { cause });
    this.name = "MigrationError";
    this.code = code;
    if (step !== undefined) this.step = step;
  }
}
