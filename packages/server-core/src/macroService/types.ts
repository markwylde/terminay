import type { ProtocolId } from "@terminay/protocol";

export const MACRO_SCHEMA_VERSION = 1;

export type MacroFieldType = "text" | "textarea" | "select" | "number" | "checkbox" | "emoji" | "file";
export type MacroFieldValue = string | number | boolean;

export interface MacroFieldOption {
  readonly label: string;
  readonly value: string;
}

export interface MacroFieldDefinition {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly type: MacroFieldType;
  readonly required: boolean;
  readonly description: string;
  readonly placeholder: string;
  readonly defaultValue: MacroFieldValue;
  readonly options: readonly MacroFieldOption[];
}

export type MacroStep =
  | { readonly id: string; readonly type: "type"; readonly content: string }
  | { readonly id: string; readonly type: "key"; readonly key: string }
  | { readonly id: string; readonly type: "secret"; readonly secretId: string }
  | { readonly id: string; readonly type: "wait_time"; readonly durationSeconds: string }
  | { readonly id: string; readonly type: "wait_inactivity"; readonly durationSeconds: string }
  | { readonly id: string; readonly type: "select_line" }
  | { readonly id: string; readonly type: "paste" };

export interface MacroDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly fields: readonly MacroFieldDefinition[];
  readonly steps: readonly MacroStep[];
}

export interface MacroState {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly cursor: string;
  readonly macros: readonly MacroDefinition[];
}

export interface MacroBackend {
  load(): Promise<unknown | undefined>;
  commit(state: MacroState): Promise<void>;
  backup?(state: MacroState): Promise<void>;
}

export type MacroCommand =
  | { readonly type: "replace"; readonly macros: readonly unknown[] }
  | { readonly type: "upsert"; readonly macro: unknown }
  | { readonly type: "remove"; readonly macroId: string }
  | { readonly type: "reset" };

export interface MacroCommandEnvelope {
  readonly commandId?: ProtocolId;
  readonly expectedRevision?: number;
  readonly command: MacroCommand;
}

export interface MacroResetOptions {
  readonly expectedRevision?: number;
  readonly commandId?: ProtocolId;
}

export interface MacroConflict {
  readonly code: "conflict";
  readonly currentRevision: number;
  readonly currentCursor: string;
  readonly message: string;
}

export type MacroApplyResult =
  | { readonly ok: true; readonly revision: number; readonly cursor: string; readonly state: MacroState }
  | { readonly ok: false; readonly conflict: MacroConflict };

export interface MacroLimits {
  readonly maxSteps?: number;
  readonly maxFields?: number;
  readonly maxStringBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxDelayMs?: number;
  readonly maxConcurrentRuns?: number;
}

export interface MacroTarget {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

export interface MacroRunAuthorization {
  readonly target: MacroTarget;
  readonly scope?: "none" | "read" | "write" | "admin";
}

export type MacroDisconnectPolicy = "cancel" | "continue";

export interface MacroExecutionEnvironment {
  /** Exact target selected by the server-side caller, never a renderer/window id. */
  readonly target: MacroTarget;
  readonly authorize?: (target: MacroTarget) => boolean;
  /** Writes terminal input directly at the server boundary. */
  readonly write: (target: MacroTarget, bytes: Uint8Array) => void | Promise<void>;
  readonly key?: (target: MacroTarget, key: string) => void | Promise<void>;
  /** Resolves a secret only while executing; the runner never stores the value. */
  readonly resolveSecret?: (target: MacroTarget, secretId: string) => Uint8Array | Promise<Uint8Array>;
  /** Wait for terminal inactivity without exposing terminal output to the client. */
  readonly waitForInactivity?: (target: MacroTarget, milliseconds: number, signal: AbortSignal) => void | Promise<void>;
  readonly now?: () => number;
}

export interface MacroRunOptions {
  readonly authorization: MacroRunAuthorization;
  readonly values?: Readonly<Record<string, MacroFieldValue>>;
  /** Optional launching-client identity used only for disconnect policy. */
  readonly launcherId?: string;
  readonly disconnectPolicy?: MacroDisconnectPolicy;
}

export type MacroRunStatus = "running" | "completed" | "canceled" | "failed";

export interface MacroRunSnapshot {
  readonly runId: string;
  readonly macroId: string;
  readonly target: MacroTarget;
  readonly status: MacroRunStatus;
  readonly stepIndex: number;
  readonly bytesWritten: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly errorCode?: string;
}

export interface MacroRunHandle {
  readonly runId: string;
  readonly snapshot: () => MacroRunSnapshot;
  readonly cancel: () => void;
  readonly promise: Promise<MacroRunSnapshot>;
}
