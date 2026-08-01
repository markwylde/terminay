import type { JsonValue, ProtocolId } from "@terminay/protocol";

/** The authority that is allowed to persist a setting. */
export type SettingAuthority =
  | "server"
  | "connection-host"
  | "device-override"
  | "transient";

export const SETTINGS_SCHEMA_VERSION = 1;

export type SettingsObject = { readonly [key: string]: JsonValue };

/** Metadata for a vault item.  The value is deliberately absent by design. */
export interface SecretReference {
  readonly id: ProtocolId;
  readonly configured: boolean;
  readonly label?: string;
  readonly version?: number;
  readonly updatedAt?: number;
}

export type SecretReferenceMap = Readonly<Record<string, SecretReference>>;

export interface ServerSettingsState {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly cursor: string;
  readonly settings: SettingsObject;
  readonly secretReferences: SecretReferenceMap;
}

export interface SettingsBackend {
  load(): Promise<unknown | undefined>;
  commit(state: ServerSettingsState): Promise<void>;
  backup?(state: ServerSettingsState): Promise<void>;
}

export interface SettingsConflict {
  readonly code: "conflict";
  readonly currentRevision: number;
  readonly currentCursor: string;
  readonly message: string;
}

export type SettingsApplyResult =
  | {
      readonly ok: true;
      readonly revision: number;
      readonly cursor: string;
      readonly state: ServerSettingsState;
    }
  | { readonly ok: false; readonly conflict: SettingsConflict };

export interface SettingsCommandEnvelope {
  readonly commandId?: ProtocolId;
  readonly expectedRevision?: number;
  readonly command: SettingsCommand;
}

export type SettingsCommand =
  | { readonly type: "set"; readonly path: string; readonly value: JsonValue }
  | { readonly type: "merge"; readonly settings: SettingsObject }
  | { readonly type: "replace"; readonly settings: SettingsObject }
  | { readonly type: "reset"; readonly path?: string };

export interface SettingsResetOptions {
  readonly expectedRevision?: number;
  readonly path?: string;
  readonly commandId?: ProtocolId;
}

export function isSettingsObject(value: unknown): value is SettingsObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneSettings<T>(value: T): T {
  return structuredClone(value);
}
