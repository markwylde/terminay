import path from "node:path";
import { statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_RECORDING_ROOT,
  MAX_RECORDING_CHUNK_BYTES,
  MAX_RECORDING_EVENT_BYTES,
  RECORDING_ID_PATTERN,
  RecordingServiceError,
  type RecordingChunk,
  type RecordingFilter,
  type RecordingListItem,
  type RecordingListOptions,
  type RecordingListResult,
  type RecordingGroup,
  type RecordingGroupBy,
  type RecordingMetadata,
  type RecordingReplayRange,
  type RecordingRootReference,
  type RecordingSessionMetadata,
  type RecordingStartOptions,
  type RecordingState,
  type RecordingSessionScope,
  type RecordingStorageEntry,
  type RecordingStorage,
  type SensitiveInputPolicy,
  type RecordingLifecycle,
  type RecordingStateListener,
} from "./types.js";
import { NodeRecordingStorage } from "./storage.js";

interface ActiveRecording {
  readonly sessionId: string;
  readonly entry: RecordingStorageEntry;
  metadata: RecordingMetadata;
  lastEventAtMs: number;
  roundingCarryMs: number;
  sensitiveInputUntilMs: number;
  captureInput: boolean;
}

const SENSITIVE_OUTPUT_PATTERN = /\b(password|passphrase|secret|token|api[-_\s]?key|private[-_\s]?key|otp|verification code|sudo)\b[^\r\n]*[:?]?\s*$/i;
const MAX_SESSION_ID_BYTES = 512;
const utf8Encoder = new TextEncoder();
const utf8ByteLength = (value: string): number => utf8Encoder.encode(value).byteLength;

function asDate(value: Date | string | undefined, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value);
  return fallback;
}

function boundedText(value: string | null | undefined, max = 512): string | null {
  if (typeof value !== "string" || value.length === 0) return value === "" ? "" : null;
  return [...value].slice(0, max).join("");
}

function numberDimension(value: number | undefined, fallback: number, minimum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

function errorMessage(error: unknown): string {
  // Paths and terminal content are intentionally not copied into metadata or logs.
  return error instanceof RecordingServiceError && error.code === "storage_failed"
    ? "The recording could not be written."
    : "The recording could not be written.";
}

function asLifecycle(value: RecordingLifecycle | undefined): RecordingLifecycle | undefined { return value; }

/**
 * Server-owned recording capture.  PTY hosts call appendOutput/appendInput at
 * their single privileged boundaries; clients are only observers of state and
 * replay DTOs.  Synchronous file commits make one PTY event one cast event,
 * even when several observers are connected.
 */
export class RecordingService {
  private readonly storage: RecordingStorage;
  private readonly active = new Map<string, ActiveRecording>();
  private readonly terminalMetadata = new Map<string, RecordingSessionMetadata>();
  private readonly failed = new Map<string, RecordingState>();
  private readonly stateListeners = new Set<RecordingStateListener>();
  private readonly options: {
    readonly serverId: string;
    readonly captureInput?: boolean | (() => boolean);
    readonly sensitiveInputPolicy?: SensitiveInputPolicy | (() => SensitiveInputPolicy);
    readonly defaultRecordNewTerminals?: boolean | (() => boolean);
    readonly maxEventBytes: number;
    readonly maxChunkBytes: number;
    readonly now: () => Date;
    readonly onStateChanged?: (state: RecordingState) => void;
  };

  constructor(options: import("./types.js").RecordingServiceOptions = {}) {
    const home = options.homeDirectory ?? options.getHomePath?.() ?? process.env.HOME ?? process.cwd();
    const root = options.recordingRoot ?? options.directory ?? DEFAULT_RECORDING_ROOT;
    const index = options.libraryIndexPath ?? options.getLibraryIndexPath?.();
    this.storage = options.storage ?? new NodeRecordingStorage({ recordingRoot: root, homeDirectory: home, ...(index === undefined ? {} : { libraryIndexPath: index }), ...(options.migrateStoredMetadata === undefined ? {} : { migrateStoredMetadata: options.migrateStoredMetadata }) });
    this.options = {
      serverId: options.serverId ?? "",
      captureInput: options.captureInput,
      sensitiveInputPolicy: options.sensitiveInputPolicy,
      defaultRecordNewTerminals: options.defaultRecordNewTerminals,
      maxEventBytes: boundedLimit(options.maxEventBytes ?? MAX_RECORDING_EVENT_BYTES, MAX_RECORDING_EVENT_BYTES, "maxEventBytes"),
      maxChunkBytes: boundedLimit(options.maxChunkBytes ?? MAX_RECORDING_CHUNK_BYTES, MAX_RECORDING_CHUNK_BYTES, "maxChunkBytes"),
      now: options.now ?? (() => new Date()),
      ...(options.onStateChanged === undefined ? {} : { onStateChanged: options.onStateChanged }),
    };
    if (this.options.onStateChanged !== undefined) this.stateListeners.add(this.options.onStateChanged);
    this.storage.recover(this.options.now());
  }

  /** Active map is exposed only as a count for diagnostics, never as paths. */
  get activeCount(): number { return this.active.size; }

  /** Subscribe to server-owned lifecycle state without affecting capture.
   * Multiple observers receive the same committed state; removing every
   * observer does not stop an active recording. */
  subscribe(listener: RecordingStateListener): () => void {
    if (typeof listener !== "function") throw new TypeError("recording listener is required");
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  get recordingRoots(): readonly string[] { return this.storage.roots; }

  /** Register a legacy root by reference; this never moves or rewrites user data. */
  importRecordingRoot(root: string): RecordingRootReference {
    if (typeof root !== "string" || root.trim().length === 0 || root.includes("\0")) throw new RecordingServiceError("invalid_root", "Recording root is invalid.");
    const describe = this.storage.describeRoot;
    if (describe === undefined) throw new RecordingServiceError("storage_failed", "Recording storage cannot import roots.");
    return describe.call(this.storage, root, false);
  }

  importLegacyRoot(root: string): RecordingRootReference { return this.importRecordingRoot(root); }

  getState(sessionId: string): RecordingState {
    this.validateSessionId(sessionId);
    const current = this.active.get(sessionId);
    if (current !== undefined) return this.toState(current);
    return this.failed.get(sessionId) ?? { sessionId, recordingId: null, status: "idle", bytesWritten: 0, eventCount: 0, startedAt: null, errorMessage: null };
  }

  getSessionScope(sessionId: string): RecordingSessionScope | undefined {
    this.validateSessionId(sessionId);
    const metadata = this.terminalMetadata.get(sessionId);
    if (metadata === undefined) return undefined;
    return { sessionId, serverId: (metadata.serverId ?? this.options.serverId) || null, projectId: metadata.projectId ?? null };
  }

  /** Starts an explicitly requested recording; repeat starts are idempotent. */
  start(sessionId: string, options: RecordingStartOptions = {}): RecordingState {
    this.validateSessionId(sessionId);
    const current = this.active.get(sessionId);
    if (current !== undefined) {
      this.updateSessionMetadata(sessionId, options);
      if (options.captureInput !== undefined) current.captureInput = options.captureInput;
      return this.toState(current);
    }
    const priorFailure = this.failed.get(sessionId);
    if (priorFailure !== undefined) return priorFailure;
    const now = asDate(options.startedAt, this.options.now());
    const remembered = this.terminalMetadata.get(sessionId) ?? {};
    const merged = {
      ...remembered,
      ...options,
      ...(options.environment === undefined ? {} : { environment: safeEnvironment(options.environment) }),
    };
    const recordingId = options.recordingId ?? randomUUID();
    if (!RECORDING_ID_PATTERN.test(recordingId)) throw new RecordingServiceError("invalid_id", "Recording id is invalid.");
    const cols = numberDimension(merged.cols, 80, 2);
    const rows = numberDimension(merged.rows, 24, 1);
    const captureInput = options.captureInput ?? this.resolveInputSetting();
    const sensitivePolicy = options.sensitiveInputPolicy ?? this.resolveSensitivePolicy();
    const date = now.toISOString().slice(0, 10);
    const metadata: RecordingMetadata = {
      version: 3,
      recordingId,
      sessionId,
      serverId: boundedText(merged.serverId ?? this.options.serverId),
      projectId: boundedText(merged.projectId),
      projectName: boundedText(merged.projectName),
      projectRoot: boundedText(merged.projectRoot, 2048),
      title: boundedText(merged.title, 512) || "Terminal",
      note: boundedText(merged.note, 4096),
      color: boundedText(merged.color, 128),
      emoji: boundedText(merged.emoji, 32),
      cwd: typeof merged.cwd === "string" ? boundedText(merged.cwd, 2048) : null,
      shell: typeof merged.shell === "string" ? boundedText(merged.shell, 2048) : null,
      cols,
      rows,
      finalCols: null,
      finalRows: null,
      startedAt: now.toISOString(),
      endedAt: null,
      durationMs: null,
      exitCode: null,
      signal: null,
      recordingState: "recording",
      capturedInput: false,
      inputPolicy: "none",
      sensitiveInputPolicy: sensitivePolicy,
      eventCount: 0,
      bytesWritten: 0,
      relativeCastPath: path.join(date, `${recordingId}.cast`),
      castSize: 0,
      format: "asciicast",
      formatVersion: 3,
      errorMessage: null,
    };
    const environment = merged.environment === undefined ? {} : safeEnvironment(merged.environment);
    const title = metadata.projectName ? `${metadata.projectName} > ${metadata.title}` : metadata.title;
    const header = JSON.stringify({ version: 3, term: { cols, rows, type: "xterm-256color" }, timestamp: Math.floor(now.getTime() / 1000), title, env: { TERM: "xterm-256color", ...(metadata.shell === null ? {} : { SHELL: metadata.shell }), ...environment } });
    let entry: RecordingStorageEntry;
    try {
      entry = this.storage.createRecording(metadata, header);
    } catch (error) {
      const state: RecordingState = { sessionId, recordingId, status: "failed", bytesWritten: 0, eventCount: 0, startedAt: metadata.startedAt, errorMessage: errorMessage(error) };
      this.failed.set(sessionId, state);
      this.emitStateValue(state);
      return state;
    }
    const initialSize = this.castSize(entry.castPath);
    const active: ActiveRecording = { sessionId, entry: { ...entry, metadata: { ...metadata, bytesWritten: initialSize, castSize: initialSize } }, metadata: { ...metadata, bytesWritten: initialSize, castSize: initialSize }, lastEventAtMs: now.getTime(), roundingCarryMs: 0, sensitiveInputUntilMs: 0, captureInput };
    this.active.set(sessionId, active);
    this.terminalMetadata.set(sessionId, { ...merged, cols, rows });
    this.emitState(active);
    return this.toState(active);
  }

  /** Automatic policy is evaluated only at PTY creation, never for existing sessions. */
  startIfEnabled(sessionId: string, metadata: RecordingStartOptions = {}): RecordingState {
    if (!this.resolveDefaultRecording()) return this.getState(sessionId);
    return this.start(sessionId, metadata);
  }

  updateSessionMetadata(sessionId: string, metadata: RecordingSessionMetadata): void {
    this.validateSessionId(sessionId);
    const next = {
      ...(this.terminalMetadata.get(sessionId) ?? {}),
      ...metadata,
      ...(metadata.environment === undefined ? {} : { environment: safeEnvironment(metadata.environment) }),
    };
    this.terminalMetadata.set(sessionId, next);
    const active = this.active.get(sessionId);
    if (active === undefined) return;
    active.metadata = {
      ...active.metadata,
      ...(metadata.serverId === undefined ? {} : { serverId: boundedText(metadata.serverId) }),
      ...(metadata.projectId === undefined ? {} : { projectId: boundedText(metadata.projectId) }),
      ...(metadata.projectName === undefined ? {} : { projectName: boundedText(metadata.projectName) }),
      ...(metadata.projectRoot === undefined ? {} : { projectRoot: boundedText(metadata.projectRoot, 2048) }),
      ...(metadata.title === undefined ? {} : { title: boundedText(metadata.title, 512) || "Terminal" }),
      ...(metadata.note === undefined ? {} : { note: boundedText(metadata.note, 4096) }),
      ...(metadata.color === undefined ? {} : { color: boundedText(metadata.color, 128) }),
      ...(metadata.emoji === undefined ? {} : { emoji: boundedText(metadata.emoji, 32) }),
      ...(metadata.cwd === undefined ? {} : { cwd: metadata.cwd === null ? null : boundedText(metadata.cwd, 2048) }),
      ...(metadata.shell === undefined ? {} : { shell: metadata.shell === null ? null : boundedText(metadata.shell, 2048) }),
    };
    this.persistMetadata(active);
    this.emitState(active);
  }

  appendOutput(sessionId: string, data: string): void { this.appendData(sessionId, "o", data); }

  appendInput(sessionId: string, data: string): void {
    const active = this.active.get(sessionId);
    if (active === undefined || active.metadata.recordingState !== "recording") return;
    if (typeof this.options.captureInput === "function") active.captureInput = this.options.captureInput();
    if (!active.captureInput) return;
    if (typeof this.options.sensitiveInputPolicy === "function") active.metadata = { ...active.metadata, sensitiveInputPolicy: this.resolveSensitivePolicy() };
    active.metadata = { ...active.metadata, capturedInput: true, inputPolicy: "record-with-sensitive-filter" };
    const filtered = this.filterInput(active, data);
    if (filtered.length > 0) this.appendData(sessionId, "i", filtered);
    else this.persistMetadata(active);
    if (data.includes("\r") || data.includes("\n")) active.sensitiveInputUntilMs = 0;
  }

  setInputCapture(sessionId: string, enabled: boolean): RecordingState {
    const active = this.active.get(sessionId);
    if (active === undefined) return this.getState(sessionId);
    active.captureInput = enabled;
    return this.toState(active);
  }

  appendResize(sessionId: string, cols: number, rows: number): void {
    const active = this.active.get(sessionId);
    if (active === undefined || active.metadata.recordingState !== "recording") return;
    const nextCols = numberDimension(cols, active.metadata.finalCols ?? active.metadata.cols, 2);
    const nextRows = numberDimension(rows, active.metadata.finalRows ?? active.metadata.rows, 1);
    const currentCols = active.metadata.finalCols ?? active.metadata.cols;
    const currentRows = active.metadata.finalRows ?? active.metadata.rows;
    if (nextCols === currentCols && nextRows === currentRows) return;
    active.metadata = { ...active.metadata, finalCols: nextCols, finalRows: nextRows };
    this.appendData(sessionId, "r", `${nextCols}x${nextRows}`);
  }

  appendMarker(sessionId: string, marker: string): void {
    this.appendData(sessionId, "m", marker);
  }

  /** Finalization is idempotent and records the terminal exit exactly once. */
  finalize(sessionId: string, exitCode: number | null = null, signal: number | null = null, lifecycle: Exclude<RecordingLifecycle, "recording"> = "completed"): RecordingState {
    const active = this.active.get(sessionId);
    if (active === undefined) return this.getState(sessionId);
    if (active.metadata.recordingState !== "recording") return this.toState(active, "failed");
    if (exitCode !== null && Number.isSafeInteger(exitCode)) {
      this.appendData(sessionId, "x", String(exitCode));
      if (this.active.get(sessionId) !== active) return this.getState(sessionId);
    }
    const ended = this.options.now();
    const finalCols = active.metadata.finalCols ?? active.metadata.cols;
    const finalRows = active.metadata.finalRows ?? active.metadata.rows;
    active.metadata = { ...active.metadata, finalCols, finalRows, endedAt: ended.toISOString(), durationMs: Math.max(0, ended.getTime() - Date.parse(active.metadata.startedAt)), exitCode: Number.isSafeInteger(exitCode) ? exitCode : null, signal: typeof signal === "number" && Number.isSafeInteger(signal) && signal > 0 ? signal : null, recordingState: lifecycle, bytesWritten: this.castSize(active.entry.castPath), castSize: this.castSize(active.entry.castPath) };
    try { this.storage.writeMetadata(active.entry, active.metadata); }
    catch { return this.markFailed(active); }
    this.active.delete(sessionId);
    this.emitState(active, lifecycle === "failed" ? "failed" : "idle");
    return this.toState(active, lifecycle === "failed" ? "failed" : "idle");
  }

  stop(sessionId: string): RecordingState { return this.finalize(sessionId, null, null, "completed"); }

  /** Server shutdown must not pretend an unfinalized PTY completed. */
  shutdown(): void {
    for (const sessionId of [...this.active.keys()]) this.finalize(sessionId, null, null, "interrupted");
    this.storage.close();
  }

  listRecordings(options: RecordingListOptions = {}): readonly RecordingListItem[] {
    const entries = this.filteredEntries(options);
    const offset = boundedOffset(options.offset);
    const limit = boundedListLimit(options.limit);
    return entries.slice(offset, offset + limit).map((entry) => this.toListItem(entry.metadata, entry.castPath));
  }

  /** Alias used by protocol adapters that call the timeline operation `list`. */
  searchRecordings(options: RecordingListOptions = {}): readonly RecordingListItem[] { return this.listRecordings(options); }

  /** Resolve one timeline item by opaque id without exposing its cast path. */
  getRecording(recordingId: string): RecordingListItem {
    const entry = this.resolveEntry(recordingId);
    return this.toListItem(entry.metadata, entry.castPath);
  }

  list(options: RecordingListOptions = {}): RecordingListResult {
    const entries = this.filteredEntries(options);
    const offset = boundedOffset(options.offset);
    const limit = boundedListLimit(options.limit);
    return { items: entries.slice(offset, offset + limit).map((entry) => this.toListItem(entry.metadata, entry.castPath)), total: entries.length, offset, limit };
  }

  groupRecordings(by: RecordingGroupBy, options: RecordingListOptions = {}): readonly RecordingGroup[] {
    const entries = this.filteredEntries(options).slice(boundedOffset(options.offset), boundedOffset(options.offset) + boundedListLimit(options.limit));
    const grouped = new Map<string, RecordingListItem[]>();
    for (const entry of entries) {
      const key = by === "date" ? entry.metadata.startedAt.slice(0, 10) : entry.metadata.projectId ?? "ungrouped";
      const list = grouped.get(key) ?? [];
      list.push(this.toListItem(entry.metadata, entry.castPath));
      grouped.set(key, list);
    }
    return [...grouped.entries()].map(([key, items]) => ({ key, label: by === "project" && key === "ungrouped" ? "No project" : key, items }));
  }

  readRecordingChunk(request: import("./types.js").RecordingChunkRequest): RecordingChunk {
    const entry = this.resolveEntry(request.recordingId);
    return this.storage.readChunk(entry, request, this.options.maxChunkBytes);
  }

  readChunk(request: import("./types.js").RecordingChunkRequest): RecordingChunk { return this.readRecordingChunk(request); }

  /** Pull-based replay stream; yielding gives the transport a backpressure point. */
  async *streamReplay(recordingId: string, options: { readonly start?: number; readonly maxBytes?: number; readonly signal?: AbortSignal } = {}): AsyncGenerator<RecordingChunk> {
    let start = options.start ?? 0;
    for (;;) {
      if (options.signal?.aborted) throw new RecordingServiceError("aborted", "Recording read was canceled.");
      const chunk = this.readRecordingChunk({ recordingId, start, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }), ...(options.signal === undefined ? {} : { signal: options.signal }) });
      yield chunk;
      if (chunk.eof || chunk.nextOffset <= start) return;
      start = chunk.nextOffset;
      await Promise.resolve();
    }
  }

  /** Bounded replay transfer; it never executes input or terminal controls. */
  readReplayRange(recordingId: string, startTime = 0, endTime: number | null = null, options: { readonly maxBytes?: number; readonly startOffset?: number; readonly signal?: AbortSignal } = {}): RecordingReplayRange {
    const entry = this.resolveEntry(recordingId);
    const chunk = this.storage.readChunk(entry, { recordingId, start: options.startOffset ?? 0, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }), ...(options.signal === undefined ? {} : { signal: options.signal }) }, this.options.maxChunkBytes);
    const events: Array<import("./types.js").RecordingReplayEvent> = [];
    let time = 0;
    let offset = options.startOffset ?? 0;
    for (const line of chunk.content.split("\n")) {
      if (line.length === 0) { offset += 1; continue; }
      try {
        const value: unknown = JSON.parse(line);
        if (!Array.isArray(value) || value.length < 3 || typeof value[0] !== "number" || typeof value[1] !== "string" || typeof value[2] !== "string") { offset += utf8ByteLength(line) + 1; continue; }
        time += Math.max(0, value[0]);
        const code = value[1];
        if (code !== "o" && code !== "i" && code !== "r" && code !== "m" && code !== "x") { offset += utf8ByteLength(line) + 1; continue; }
        const event = { offset, time, code, data: value[2] } as import("./types.js").RecordingReplayEvent;
        if (time >= startTime && (endTime === null || time <= endTime)) events.push(event);
        offset += utf8ByteLength(line) + 1;
      } catch { offset += utf8ByteLength(line) + 1; }
    }
    return { recordingId, startTime, endTime, events, nextOffset: chunk.nextOffset, eof: chunk.eof };
  }

  deleteRecordingById(recordingId: string): void {
    const entry = this.resolveEntry(recordingId);
    if (this.active.get(entry.metadata.sessionId)?.entry.castPath === entry.castPath || entry.metadata.recordingState === "recording") throw new RecordingServiceError("active_recording", "Stop the active recording before deleting it.");
    this.storage.delete(entry);
  }

  delete(recordingId: string, options: { readonly stopFirst?: boolean } = {}): void {
    const entry = this.resolveEntry(recordingId);
    if (entry.metadata.recordingState === "recording") {
      if (!options.stopFirst) throw new RecordingServiceError("active_recording", "Stop the active recording before deleting it.");
      if (entry.metadata.sessionId) this.finalize(entry.metadata.sessionId);
    }
    this.deleteRecordingById(recordingId);
  }

  /** Host-only helper; transport DTOs must use recording id and reveal capability. */
  resolveRevealPathById(recordingId: string): string {
    return this.resolveEntry(recordingId).castPath;
  }

  private appendData(sessionId: string, code: "o" | "i" | "r" | "m" | "x", data: string): void {
    const active = this.active.get(sessionId);
    if (active === undefined || active.metadata.recordingState !== "recording") return;
    if (typeof data !== "string") return;
    if (code === "o" && SENSITIVE_OUTPUT_PATTERN.test(data)) active.sensitiveInputUntilMs = this.options.now().getTime() + 120_000;
    // Keep one complete NDJSON record within the largest replay transfer so
    // clients never receive an unstreamable event.  The small headroom covers
    // the timestamp/code JSON envelope.
    const pieces = splitUtf8(data, Math.min(this.options.maxEventBytes, Math.max(1, this.options.maxChunkBytes - 1024)));
    for (const piece of pieces) {
      const now = this.options.now().getTime();
      const raw = Math.max(0, now - active.lastEventAtMs + active.roundingCarryMs);
      const rounded = Math.round(raw);
      active.roundingCarryMs = raw - rounded;
      active.lastEventAtMs = now;
      const line = `${JSON.stringify([rounded / 1000, code, piece])}\n`;
      try {
        this.storage.append(active.entry, line);
        const bytes = utf8ByteLength(line);
        active.metadata = { ...active.metadata, eventCount: active.metadata.eventCount + 1, bytesWritten: active.metadata.bytesWritten + bytes, castSize: active.metadata.castSize + bytes };
        this.persistMetadata(active);
        this.emitState(active);
      } catch { this.markFailed(active); return; }
    }
  }

  private filterInput(active: ActiveRecording, data: string): string {
    if (this.options.now().getTime() > active.sensitiveInputUntilMs) return data;
    if (active.metadata.sensitiveInputPolicy === "drop") return data.includes("\r") || data.includes("\n") ? data.replace(/[^\r\n]/g, "") : "";
    return data.replace(/[ -~]/g, (character) => character === "\r" || character === "\n" ? character : "*");
  }

  private persistMetadata(active: ActiveRecording): void {
    try { this.storage.writeMetadata(active.entry, active.metadata); }
    catch { this.markFailed(active); }
  }

  private markFailed(active: ActiveRecording): RecordingState {
    const state: RecordingState = { sessionId: active.sessionId, recordingId: active.metadata.recordingId, status: "failed", bytesWritten: active.metadata.bytesWritten, eventCount: active.metadata.eventCount, startedAt: active.metadata.startedAt, errorMessage: "The recording could not be written." };
    active.metadata = { ...active.metadata, recordingState: "failed", endedAt: this.options.now().toISOString(), durationMs: Math.max(0, this.options.now().getTime() - Date.parse(active.metadata.startedAt)), errorMessage: state.errorMessage, bytesWritten: this.castSize(active.entry.castPath), castSize: this.castSize(active.entry.castPath) };
    try { this.storage.writeMetadata(active.entry, active.metadata); } catch { /* failure state remains in memory */ }
    this.active.delete(active.sessionId);
    this.failed.set(active.sessionId, state);
    this.emitState(active, "failed");
    return state;
  }

  private filteredEntries(options: RecordingFilter): readonly RecordingStorageEntry[] {
    const entries = this.storage.list().filter((entry) => {
      const metadata = entry.metadata;
      const search = options.search?.trim().toLocaleLowerCase();
      if (search !== undefined && search.length > 0) {
        const haystack = [metadata.title, metadata.projectName, metadata.cwd, metadata.note, metadata.startedAt].filter((value): value is string => value !== null).join(" ").toLocaleLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (options.projectId !== undefined && metadata.projectId !== options.projectId) return false;
      if (asLifecycle(options.state) !== undefined && metadata.recordingState !== options.state) return false;
      if (options.inputPresent !== undefined && metadata.capturedInput !== options.inputPresent) return false;
      if (options.startedAfter !== undefined && Date.parse(metadata.startedAt) < Date.parse(asDate(options.startedAfter, new Date(0)).toISOString())) return false;
      if (options.startedBefore !== undefined && Date.parse(metadata.startedAt) > Date.parse(asDate(options.startedBefore, new Date()).toISOString())) return false;
      return true;
    });
    return [...entries].sort((left, right) => Date.parse(right.metadata.startedAt) - Date.parse(left.metadata.startedAt));
  }

  private resolveEntry(recordingId: string): RecordingStorageEntry {
    if (typeof recordingId !== "string" || !RECORDING_ID_PATTERN.test(recordingId)) throw new RecordingServiceError("invalid_id", "Recording id is invalid.");
    const entry = this.storage.list().find((candidate) => candidate.metadata.recordingId === recordingId);
    if (entry === undefined) throw new RecordingServiceError("not_found", "Recording does not exist.");
    return entry;
  }

  private toListItem(metadata: RecordingMetadata, castPath: string): RecordingListItem {
    let castAvailable = false;
    let bytes = metadata.castSize;
    try { const stats = statSync(castPath) as unknown as { readonly size: number; isFile(): boolean }; castAvailable = stats.isFile(); bytes = stats.size; } catch { /* unavailable cast stays listed */ }
    return {
      version: 3,
      recordingId: metadata.recordingId,
      sessionId: metadata.sessionId,
      serverId: metadata.serverId,
      projectId: metadata.projectId,
      projectName: metadata.projectName,
      title: metadata.title,
      note: metadata.note,
      color: metadata.color,
      emoji: metadata.emoji,
      cols: metadata.cols,
      rows: metadata.rows,
      finalCols: metadata.finalCols,
      finalRows: metadata.finalRows,
      startedAt: metadata.startedAt,
      endedAt: metadata.endedAt,
      durationMs: metadata.durationMs,
      exitCode: metadata.exitCode,
      signal: metadata.signal,
      recordingState: metadata.recordingState,
      capturedInput: metadata.capturedInput,
      inputPolicy: metadata.inputPolicy,
      sensitiveInputPolicy: metadata.sensitiveInputPolicy,
      eventCount: metadata.eventCount,
      bytesWritten: bytes,
      castSize: bytes,
      format: metadata.format,
      formatVersion: metadata.formatVersion,
      errorMessage: metadata.errorMessage,
      castAvailable,
      cwdLabel: baseName(metadata.cwd),
      shellName: baseName(metadata.shell),
    };
  }

  private emitState(active: ActiveRecording, status: RecordingState["status"] = "recording"): void { this.emitStateValue(this.toState(active, status)); }
  private emitStateValue(state: RecordingState): void {
    for (const listener of [...this.stateListeners]) {
      try { listener(state); } catch { /* observers cannot affect capture */ }
    }
  }
  private toState(active: ActiveRecording, status: RecordingState["status"] = active.metadata.recordingState === "failed" ? "failed" : "recording"): RecordingState {
    return { sessionId: active.sessionId, recordingId: active.metadata.recordingId, status, bytesWritten: active.metadata.bytesWritten, eventCount: active.metadata.eventCount, startedAt: active.metadata.startedAt, errorMessage: active.metadata.errorMessage };
  }
  private resolveInputSetting(): boolean { const value = this.options.captureInput; return typeof value === "function" ? value() : value === true; }
  private resolveSensitivePolicy(): SensitiveInputPolicy { const value = this.options.sensitiveInputPolicy; return typeof value === "function" ? value() : value === "mask" ? "mask" : "drop"; }
  private resolveDefaultRecording(): boolean { const value = this.options.defaultRecordNewTerminals; return typeof value === "function" ? value() : value === true; }
  private validateSessionId(sessionId: string): void { if (typeof sessionId !== "string" || sessionId.length === 0 || utf8ByteLength(sessionId) > MAX_SESSION_ID_BYTES || sessionId.includes("\0")) throw new RecordingServiceError("invalid_id", "Terminal session id is invalid."); }
  private castSize(castPath: string): number { try { return statSync(castPath).size; } catch { return 0; } }
}

function boundedLimit(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} must be between 1 and ${maximum}.`);
  return value;
}
function boundedListLimit(value: number | undefined): number { if (value === undefined) return 200; if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new RangeError("recording list limit is invalid"); return value; }
function boundedOffset(value: number | undefined): number { if (value === undefined) return 0; if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("recording list offset is invalid"); return value; }
function splitUtf8(value: string, maxBytes: number): string[] {
  if (utf8ByteLength(value) <= maxBytes) return [value];
  const output: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of value) {
    const size = utf8ByteLength(character);
    if (current.length > 0 && bytes + size > maxBytes) { output.push(current); current = ""; bytes = 0; }
    current += character; bytes += size;
  }
  if (current.length > 0) output.push(current);
  return output.length > 0 ? output : [""];
}
function safeEnvironment(value: Readonly<Record<string, string>>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of ["TERM", "SHELL"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length <= 256) output[key] = candidate;
  }
  return output;
}
function baseName(value: string | null): string | null { return value === null || value.length === 0 ? null : path.basename(value); }
