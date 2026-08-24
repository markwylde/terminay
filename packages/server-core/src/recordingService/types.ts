import type { JsonValue } from "@terminay/protocol";
import type { CommandRequest, OperationPolicy, QueryRequest } from "../types.js";

/**
 * The recording service is deliberately expressed in terms of small data
 * contracts.  A server transport may serialize these values, but the service
 * never depends on a transport (or on Electron).
 */

export type RecordingLifecycle = "recording" | "completed" | "interrupted" | "failed";
export type InputPolicy = "none" | "record-with-sensitive-filter";
export type SensitiveInputPolicy = "drop" | "mask";

export interface RecordingSessionMetadata {
  readonly serverId?: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly projectRoot?: string;
  readonly title?: string;
  readonly note?: string;
  readonly color?: string;
  readonly emoji?: string;
  readonly cwd?: string | null;
  readonly shell?: string | null;
  readonly cols?: number;
  readonly rows?: number;
  /** Safe display values only; secrets must not be supplied here. */
  readonly environment?: Readonly<Record<string, string>>;
}

export interface RecordingStartOptions extends RecordingSessionMetadata {
  /** Input capture is separate consent and is off unless explicitly true. */
  readonly captureInput?: boolean;
  readonly sensitiveInputPolicy?: SensitiveInputPolicy;
  readonly recordingId?: string;
  readonly startedAt?: Date | string;
}

export interface RecordingState {
  readonly sessionId: string;
  readonly recordingId: string | null;
  readonly status: "idle" | "recording" | "failed";
  readonly bytesWritten: number;
  readonly eventCount: number;
  readonly startedAt: string | null;
  readonly errorMessage: string | null;
}

/** Observer callback for server-owned recording lifecycle state. Observers
 * never participate in capture commits and may disconnect independently. */
export type RecordingStateListener = (state: RecordingState) => void;

export interface RecordingSessionScope {
  readonly sessionId: string;
  readonly serverId: string | null;
  readonly projectId: string | null;
}

/** Metadata-only reference to a configured/legacy root; never a filesystem path. */
export interface RecordingRootReference {
  readonly rootId: string;
  readonly available: boolean;
  readonly recordingCount: number;
}

export interface RecordingMetadata {
  readonly version: 3;
  readonly recordingId: string;
  readonly sessionId: string;
  readonly serverId: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly projectRoot: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly color: string | null;
  readonly emoji: string | null;
  readonly cwd: string | null;
  readonly shell: string | null;
  readonly cols: number;
  readonly rows: number;
  readonly finalCols: number | null;
  readonly finalRows: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly recordingState: RecordingLifecycle;
  readonly capturedInput: boolean;
  readonly inputPolicy: InputPolicy;
  readonly sensitiveInputPolicy: SensitiveInputPolicy;
  readonly eventCount: number;
  readonly bytesWritten: number;
  /** Relative to the configured root; never returned as an absolute path. */
  readonly relativeCastPath: string;
  readonly castSize: number;
  readonly format: "asciicast";
  readonly formatVersion: 3;
  readonly errorMessage: string | null;
}

/** Timeline DTO: path snapshots are intentionally not sent to clients. */
export interface RecordingListItem extends Omit<RecordingMetadata, "cwd" | "projectRoot" | "shell" | "relativeCastPath"> {
  readonly castAvailable: boolean;
  readonly cwdLabel: string | null;
  readonly shellName: string | null;
}

export interface RecordingFilter {
  readonly search?: string;
  readonly projectId?: string;
  readonly state?: RecordingLifecycle;
  readonly inputPresent?: boolean;
  readonly startedAfter?: string | Date;
  readonly startedBefore?: string | Date;
}

export interface RecordingListOptions extends RecordingFilter {
  readonly limit?: number;
  readonly offset?: number;
}

export interface RecordingListResult {
  readonly items: readonly RecordingListItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export type RecordingGroupBy = "date" | "project";

export interface RecordingGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly RecordingListItem[];
}

export interface RecordingChunkRequest {
  readonly recordingId: string;
  readonly start?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface RecordingChunk {
  readonly recordingId: string;
  readonly start: number;
  readonly nextOffset: number;
  readonly totalSize: number;
  readonly content: string;
  readonly eof: boolean;
  /** A final non-newline record is withheld until it is complete. */
  readonly incompleteTail: boolean;
}

export interface RecordingReplayEvent {
  readonly offset: number;
  readonly time: number;
  readonly code: "o" | "i" | "r" | "m" | "x";
  readonly data: string;
}

export interface RecordingReplayRange {
  readonly recordingId: string;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly events: readonly RecordingReplayEvent[];
  readonly nextOffset: number;
  readonly eof: boolean;
}

export interface RecordingServiceOptions {
  /** Current recording root.  `~/...` expands against homeDirectory. */
  readonly recordingRoot?: string;
  readonly directory?: string;
  readonly homeDirectory?: string;
  readonly getHomePath?: () => string;
  readonly libraryIndexPath?: string;
  readonly getLibraryIndexPath?: () => string;
  readonly serverId?: string;
  /** Privileged startup-only compatibility migration for stored recording
   * metadata. The callback never receives terminal content and is applied by
   * native storage before list/replay authorization. */
  readonly migrateStoredMetadata?: (metadata: RecordingMetadata) => RecordingMetadata;
  readonly captureInput?: boolean | (() => boolean);
  readonly sensitiveInputPolicy?: SensitiveInputPolicy | (() => SensitiveInputPolicy);
  readonly defaultRecordNewTerminals?: boolean | (() => boolean);
  readonly maxEventBytes?: number;
  readonly maxChunkBytes?: number;
  readonly now?: () => Date;
  readonly onStateChanged?: RecordingStateListener;
  /** Optional server-owned adapter for tests or a non-native filesystem. */
  readonly storage?: RecordingStorage;
}

export interface RecordingAuthorization {
  readonly serverId: string;
  readonly clientId?: string;
  readonly projectId?: string;
  readonly scope: "none" | "read" | "write" | "admin";
}

export interface RecordingListRequest {
  readonly authorization: RecordingAuthorization;
  readonly options?: RecordingListOptions;
}

export interface RecordingReplayRequest {
  readonly authorization: RecordingAuthorization;
  readonly recordingId: string;
  readonly start?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface RecordingStartRequest {
  readonly authorization: RecordingAuthorization;
  readonly sessionId: string;
  readonly projectId?: string;
  readonly metadata?: RecordingStartOptions;
}

export interface RecordingStopRequest {
  readonly authorization: RecordingAuthorization;
  readonly sessionId: string;
  readonly projectId?: string;
}

export interface RecordingDeleteRequest {
  readonly authorization: RecordingAuthorization;
  readonly recordingId: string;
  readonly stopFirst?: boolean;
}

export interface RecordingRevealRequest {
  readonly authorization: RecordingAuthorization;
  readonly recordingId: string;
}

export interface RecordingRevealResult {
  readonly recordingId: string;
  readonly available: boolean;
  readonly guidance: string;
}

export interface RecordingAdapterOptions {
  readonly serverId: string;
  /** Resolve the canonical terminal owner before starting capture. A supplied
   * resolver fails closed for unknown or cross-project session ids. */
  readonly resolveSessionProject?: (sessionId: string) => string | undefined;
  /** Optional project ACL. A missing callback means server-wide authorization. */
  readonly authorizeProject?: (authorization: RecordingAuthorization, projectId: string | null) => boolean;
  /** True only for a client representing the server machine, never from a raw client flag. */
  readonly hasHostRevealCapability?: (authorization: RecordingAuthorization) => boolean;
  /** Performs the host-side reveal without returning a path to the client. */
  readonly revealOnHost?: (castPath: string, recordingId: string) => void | Promise<void>;
}

export interface RecordingOperationHandlers {
  readonly queries: Readonly<Record<string, (request: QueryRequest) => JsonValue | Promise<JsonValue>>>;
  readonly commands: Readonly<Record<string, (request: CommandRequest) => JsonValue | Promise<JsonValue>>>;
  readonly policies: Readonly<Record<string, OperationPolicy>>;
}

export interface RecordingStorageEntry {
  readonly metadata: RecordingMetadata;
  readonly castPath: string;
}

export interface RecordingStorage {
  readonly roots: readonly string[];
  registerRoot(root: string, create?: boolean): string;
  describeRoot?(root: string, create?: boolean): RecordingRootReference;
  createRecording(metadata: RecordingMetadata, header: string): RecordingStorageEntry;
  append(entry: RecordingStorageEntry, text: string): void;
  writeMetadata(entry: RecordingStorageEntry, metadata: RecordingMetadata): void;
  readMetadata(entry: RecordingStorageEntry): RecordingMetadata | null;
  list(): readonly RecordingStorageEntry[];
  readChunk(entry: RecordingStorageEntry, request: RecordingChunkRequest, maxChunkBytes: number): RecordingChunk;
  delete(entry: RecordingStorageEntry): void;
  recover(now: Date): void;
  close(): void;
}

export class RecordingServiceError extends Error {
  readonly code:
    | "invalid_id"
    | "invalid_root"
    | "path_escape"
    | "not_found"
    | "active_recording"
    | "chunk_limit"
    | "invalid_offset"
    | "malformed_recording"
    | "storage_failed"
    | "aborted"
    | "forbidden"
    | "invalid_request"
    | "capability_unavailable";

  constructor(code: RecordingServiceError["code"], message: string) {
    super(message);
    this.name = "RecordingServiceError";
    this.code = code;
  }
}

export const DEFAULT_RECORDING_ROOT = "~/Documents/TerminaySessions";
export const DEFAULT_RECORDING_CHUNK_BYTES = 64 * 1024;
export const MAX_RECORDING_CHUNK_BYTES = 256 * 1024;
export const MAX_RECORDING_EVENT_BYTES = 1024 * 1024;
export const MAX_RECORDING_LIST_LIMIT = 200;
export const RECORDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
