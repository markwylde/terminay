import { FileServiceError, type ExternalDiskChange, type FileMetadata, type FileMutationResult, type FileReadRange, type FileSessionMetadata, type FileSessionOptions, type FileSessionState, type FileSessionStorage, type FileWatchState, type ReloadOptions, type SaveOptions } from "./types.js";

const DEFAULT_MAX_RANGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_DRAFT_BYTES = 100 * 1024 * 1024;

export interface ApplyDraftOptions {
  readonly expectedDraftRevision?: number;
}

export interface ApplyDraftPatchOptions extends ApplyDraftOptions {
  readonly offset: number;
}

export interface FileSessionOpenOptions extends FileSessionOptions {
  readonly loadInitialBytes?: boolean;
}

/** One canonical path's server-owned disk/draft lifecycle. */
export class FileSession {
  readonly canonicalPath: string;
  readonly storage: FileSessionStorage;
  readonly maxRangeBytes: number;
  readonly maxDraftBytes: number;

  private diskRevisionValue: number;
  private draftRevisionValue = 0;
  private baseDraftRevisionValue = 0;
  private draftBaseDiskRevisionValue: number;
  private diskIdentityValue: string | undefined;
  private diskMtimeMsValue: number | undefined;
  private diskModeValue: number | undefined;
  private sizeValue: number | undefined;
  private draftBytes: Uint8Array | undefined;
  private diskBytes: Uint8Array | undefined;
  private dirtyValue = false;
  private conflictValue = false;
  private watchStateValue: FileWatchState = "watching";

  constructor(canonicalPath: string, storage: FileSessionStorage, options: FileSessionOptions = {}) {
    if (typeof canonicalPath !== "string" || canonicalPath.length === 0 || canonicalPath.includes("\0")) throw new FileServiceError("invalid_path", "canonical file path is invalid");
    if (typeof storage.atomicWrite !== "function") throw new TypeError("file session storage must provide atomicWrite");
    this.canonicalPath = canonicalPath;
    this.storage = storage;
    this.maxRangeBytes = boundedLimit(options.maxRangeBytes ?? DEFAULT_MAX_RANGE_BYTES, "maxRangeBytes");
    this.maxDraftBytes = boundedLimit(options.maxDraftBytes ?? DEFAULT_MAX_DRAFT_BYTES, "maxDraftBytes");
    this.diskRevisionValue = boundedRevision(options.diskRevision ?? 1, "diskRevision");
    this.draftBaseDiskRevisionValue = this.diskRevisionValue;
    this.setDiskMetadata(options.initialMetadata);
    if (options.initialBytes !== undefined) {
      const initial = copyBytes(options.initialBytes);
      if (initial.byteLength > this.maxDraftBytes) throw new FileServiceError("draft_too_large", "initial file exceeds draft limit", { max: this.maxDraftBytes });
      this.diskBytes = initial;
      this.sizeValue = initial.byteLength;
    }
  }

  static async open(canonicalPath: string, storage: FileSessionStorage, options: FileSessionOpenOptions = {}): Promise<FileSession> {
    const metadata = options.initialMetadata ?? await storage.stat?.(canonicalPath);
    let initialBytes = options.initialBytes;
    if (initialBytes === undefined && options.loadInitialBytes === true) {
      if (storage.readFile === undefined) throw new FileServiceError("write_failed", "storage cannot load initial bytes");
      initialBytes = await storage.readFile(canonicalPath);
    }
    return new FileSession(canonicalPath, storage, { ...options, ...(metadata === undefined ? {} : { initialMetadata: metadata }), ...(initialBytes === undefined ? {} : { initialBytes }) });
  }

  get state(): FileSessionState { return this.snapshot(); }
  get diskRevision(): number { return this.diskRevisionValue; }
  get draftRevision(): number { return this.draftRevisionValue; }
  get dirty(): boolean { return this.dirtyValue; }
  get conflict(): boolean { return this.conflictValue; }

  /**
   * Return canonical, bounded metadata for the current session revision.
   *
   * Metadata is deliberately read from the server-owned session state. A
   * client cannot turn an arbitrary path or stale stat response into file
   * authority, and no content bytes are included in this response.
   */
  metadata(): FileSessionMetadata {
    const checked = this.ensureOpen();
    if (!checked.ok) throw checked.error;
    return {
      canonicalPath: this.canonicalPath,
      ...(this.sizeValue === undefined ? {} : { size: this.sizeValue }),
      ...(this.draftBytes === undefined ? {} : { draftSize: this.draftBytes.byteLength }),
      ...(this.diskMtimeMsValue === undefined ? {} : { mtimeMs: this.diskMtimeMsValue }),
      ...(this.diskModeValue === undefined ? {} : { mode: this.diskModeValue }),
      ...(this.diskIdentityValue === undefined ? {} : { diskIdentity: this.diskIdentityValue }),
      diskRevision: this.diskRevisionValue,
      draftRevision: this.draftRevisionValue,
      dirty: this.dirtyValue,
      conflict: this.conflictValue,
      watchState: this.watchStateValue,
    };
  }

  snapshot(): FileSessionState {
    return {
      canonicalPath: this.canonicalPath,
      diskRevision: this.diskRevisionValue,
      draftRevision: this.draftRevisionValue,
      baseDraftRevision: this.baseDraftRevisionValue,
      draftBaseDiskRevision: this.draftBaseDiskRevisionValue,
      dirty: this.dirtyValue,
      conflict: this.conflictValue,
      watchState: this.watchStateValue,
      ...(this.sizeValue === undefined ? {} : { size: this.sizeValue }),
      ...(this.draftBytes === undefined ? {} : { draftSize: this.draftBytes.byteLength }),
      ...(this.diskIdentityValue === undefined ? {} : { diskIdentity: this.diskIdentityValue }),
    };
  }

  /** Apply a complete text/HEX draft while checking the client's ordered revision. */
  applyDraft(bytes: Uint8Array, options: ApplyDraftOptions | number = {}): FileMutationResult<FileSessionState> {
    const checked = this.ensureOpen();
    if (!checked.ok) return checked;
    if (!(bytes instanceof Uint8Array)) throw new TypeError("draft must be a Uint8Array");
    const expected = typeof options === "number" ? options : options.expectedDraftRevision;
    const revision = expected ?? this.draftRevisionValue;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError("expectedDraftRevision must be a non-negative safe integer");
    if (revision !== this.draftRevisionValue) return this.revisionFailure("draft revision is stale", revision, this.draftRevisionValue);
    if (bytes.byteLength > this.maxDraftBytes) return { ok: false, error: new FileServiceError("draft_too_large", "draft exceeds the configured limit", { max: this.maxDraftBytes }) };
    this.draftBytes = copyBytes(bytes);
    this.draftRevisionValue += 1;
    this.dirtyValue = true;
    this.draftBaseDiskRevisionValue = this.diskRevisionValue;
    this.watchStateValue = this.conflictValue ? "conflict" : "watching";
    return { ok: true, value: this.snapshot() };
  }

  edit(bytes: Uint8Array, options?: ApplyDraftOptions | number): FileMutationResult<FileSessionState> {
    return this.applyDraft(bytes, options);
  }

  async applyDraftPatch(bytes: Uint8Array, options: ApplyDraftPatchOptions | number): Promise<FileMutationResult<FileSessionState>> {
    const checked = this.ensureOpen();
    if (!checked.ok) return checked;
    if (!(bytes instanceof Uint8Array)) throw new TypeError("draft patch must be a Uint8Array");
    const offset = typeof options === "number" ? options : options.offset;
    const expected = typeof options === "number" ? undefined : options.expectedDraftRevision;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new FileServiceError("invalid_range", "draft patch offset is invalid");
    const current = this.draftBytes === undefined ? await this.readWholeForDraft() : copyBytes(this.draftBytes);
    if (offset + bytes.byteLength > this.maxDraftBytes) return { ok: false, error: new FileServiceError("draft_too_large", "draft exceeds the configured limit", { max: this.maxDraftBytes }) };
    const nextLength = Math.max(current.byteLength, offset + bytes.byteLength);
    if (nextLength > this.maxDraftBytes) return { ok: false, error: new FileServiceError("draft_too_large", "draft exceeds the configured limit", { max: this.maxDraftBytes }) };
    const next = new Uint8Array(nextLength); next.set(current); next.set(bytes, offset);
    return this.applyDraft(next, { expectedDraftRevision: expected });
  }

  async readRange(offset: number, length: number, signal?: AbortSignal): Promise<FileReadRange> {
    const checked = this.ensureOpen();
    if (!checked.ok) throw checked.error;
    validateRange(offset, length, this.maxRangeBytes);
    throwIfAborted(signal);
    const source = this.draftBytes;
    let bytes: Uint8Array;
    let totalSize = this.sizeValue;
    if (source !== undefined) {
      totalSize = source.byteLength;
      bytes = source.slice(offset, Math.min(source.byteLength, offset + length));
    } else {
      if (this.storage.readRange === undefined && this.storage.readFile === undefined) throw new Error("storage cannot read file content");
      bytes = this.storage.readRange !== undefined
        ? await this.storage.readRange(this.canonicalPath, offset, length, signal)
        : (await this.storage.readFile!(this.canonicalPath, signal)).slice(offset, offset + length);
      if (bytes.byteLength > length) bytes = bytes.slice(0, length);
      if (totalSize === undefined && this.storage.stat !== undefined) {
        totalSize = (await this.storage.stat(this.canonicalPath, signal)).size;
      }
    }
    throwIfAborted(signal);
    return {
      canonicalPath: this.canonicalPath,
      offset,
      requestedLength: length,
      bytes: copyBytes(bytes),
      ...(totalSize === undefined ? {} : { totalSize }),
      diskRevision: this.diskRevisionValue,
      draftRevision: this.draftRevisionValue,
      dirty: this.dirtyValue,
      conflict: this.conflictValue,
    };
  }

  readBytes(offset: number, length: number, signal?: AbortSignal): Promise<FileReadRange> {
    return this.readRange(offset, length, signal);
  }

  /** Apply a server watch/stat notification without ever dropping a dirty draft. */
  observeDiskChange(change: ExternalDiskChange = {}): FileSessionState {
    const checked = this.ensureOpen();
    if (!checked.ok) throw checked.error;
    const nextRevision = change.diskRevision ?? this.diskRevisionValue + 1;
    if (!Number.isSafeInteger(nextRevision) || nextRevision <= this.diskRevisionValue) throw new FileServiceError("revision_conflict", "disk revision is stale", { expected: this.diskRevisionValue + 1, actual: nextRevision });
    this.diskRevisionValue = nextRevision;
    // A watch event without fresh host metadata must not expose the previous
    // file identity or timestamps after an atomic replacement.
    this.clearHostMetadata();
    this.setDiskMetadata(change.metadata);
    if (change.bytes !== undefined) {
      this.diskBytes = copyBytes(change.bytes);
      this.sizeValue = change.bytes.byteLength;
    } else {
      this.diskBytes = undefined;
      if (change.metadata === undefined) this.sizeValue = undefined;
    }
    if (this.dirtyValue) {
      this.conflictValue = true;
      this.watchStateValue = "conflict";
    } else {
      this.conflictValue = false;
      this.watchStateValue = "watching";
      this.draftBaseDiskRevisionValue = this.diskRevisionValue;
    }
    return this.snapshot();
  }

  onExternalChange(change?: ExternalDiskChange): FileSessionState {
    return this.observeDiskChange(change);
  }

  /** Explicitly rebase the retained local draft onto the latest disk revision. */
  keepLocal(): FileMutationResult<FileSessionState> {
    const checked = this.ensureOpen();
    if (!checked.ok) return checked;
    if (!this.dirtyValue) { this.conflictValue = false; this.watchStateValue = "watching"; return { ok: true, value: this.snapshot() }; }
    this.conflictValue = false;
    this.watchStateValue = "watching";
    return { ok: true, value: this.snapshot() };
  }

  async reload(options: ReloadOptions = {}): Promise<FileMutationResult<FileSessionState>> {
    const checked = this.ensureOpen();
    if (!checked.ok) return checked;
    if (this.dirtyValue && options.confirm !== true) return { ok: false, error: new FileServiceError("confirmation_required", "reloading would discard local edits") };
    const revisionFailure = this.checkExpected(options.expectedDiskRevision, this.diskRevisionValue, "disk revision is stale");
    if (revisionFailure !== undefined) return revisionFailure;
    const draftFailure = this.checkExpected(options.expectedDraftRevision, this.draftRevisionValue, "draft revision is stale");
    if (draftFailure !== undefined) return draftFailure;
    let metadata: FileMetadata | undefined;
    if (this.storage.stat !== undefined) metadata = await this.storage.stat(this.canonicalPath);
    this.diskBytes = undefined;
    this.draftBytes = undefined;
    this.sizeValue = undefined;
    this.clearHostMetadata();
    this.dirtyValue = false;
    this.conflictValue = false;
    this.baseDraftRevisionValue = this.draftRevisionValue;
    this.draftBaseDiskRevisionValue = this.diskRevisionValue;
    this.watchStateValue = "watching";
    this.setDiskMetadata(metadata);
    return { ok: true, value: this.snapshot() };
  }

  async save(options: SaveOptions | number = {}): Promise<FileMutationResult<FileSessionState>> {
    const checked = this.ensureOpen();
    if (!checked.ok) return checked;
    const normalized: SaveOptions = typeof options === "number" ? { expectedDiskRevision: options } : options;
    const diskFailure = this.checkExpected(normalized.expectedDiskRevision, this.diskRevisionValue, "disk revision save precondition failed");
    if (diskFailure !== undefined) return { ok: false, error: new FileServiceError("save_precondition", diskFailure.error.message, diskFailure.error.details) };
    const draftFailure = this.checkExpected(normalized.expectedDraftRevision, this.draftRevisionValue, "draft revision save precondition failed");
    if (draftFailure !== undefined) return { ok: false, error: new FileServiceError("save_precondition", draftFailure.error.message, draftFailure.error.details) };
    if (!this.dirtyValue || this.draftBytes === undefined) return { ok: false, error: new FileServiceError("not_dirty", "file has no local edits") };
    if (this.conflictValue) return { ok: false, error: new FileServiceError("save_precondition", "file has an unresolved external conflict") };
    const bytes = copyBytes(this.draftBytes);
    try {
      await this.storage.atomicWrite(this.canonicalPath, bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "atomic save failed";
      return { ok: false, error: new FileServiceError("write_failed", message) };
    }
    this.diskRevisionValue += 1;
    this.diskBytes = bytes;
    this.sizeValue = bytes.byteLength;
    this.clearHostMetadata();
    this.draftBytes = undefined;
    this.dirtyValue = false;
    this.conflictValue = false;
    this.baseDraftRevisionValue = this.draftRevisionValue;
    this.draftBaseDiskRevisionValue = this.diskRevisionValue;
    this.watchStateValue = "watching";
    return { ok: true, value: this.snapshot() };
  }

  setWatchState(state: Exclude<FileWatchState, "closed">): FileSessionState {
    const checked = this.ensureOpen();
    if (!checked.ok) throw checked.error;
    this.watchStateValue = state;
    return this.snapshot();
  }

  close(): FileMutationResult<FileSessionState> {
    if (this.watchStateValue === "closed") return { ok: true, value: this.snapshot() };
    if (this.dirtyValue) return { ok: false, error: new FileServiceError("save_precondition", "dirty file requires explicit save, reload, or keep-local before close") };
    this.watchStateValue = "closed";
    this.diskBytes = undefined;
    this.draftBytes = undefined;
    return { ok: true, value: this.snapshot() };
  }

  private ensureOpen(): FileMutationResult<FileSessionState> {
    if (this.watchStateValue === "closed") return { ok: false, error: new FileServiceError("session_closed", "file session is closed") };
    return { ok: true, value: this.snapshot() };
  }

  private checkExpected(expected: number | undefined, actual: number, message: string): FileMutationFailureOrUndefined {
    if (expected === undefined) return undefined;
    if (!Number.isSafeInteger(expected) || expected < 0) throw new RangeError("expected revision must be a non-negative safe integer");
    if (expected !== actual) return this.revisionFailure(message, expected, actual);
    return undefined;
  }

  private revisionFailure(message: string, expected: number, actual: number): FileMutationFailure {
    return { ok: false, error: new FileServiceError("revision_conflict", message, { expected, actual }) };
  }

  private setDiskMetadata(metadata: FileMetadata | undefined): void {
    if (metadata === undefined) return;
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) throw new TypeError("file metadata size is invalid");
    if (metadata.mtimeMs !== undefined && (!Number.isFinite(metadata.mtimeMs) || metadata.mtimeMs < 0)) throw new TypeError("file metadata mtime is invalid");
    if (metadata.mode !== undefined && (!Number.isSafeInteger(metadata.mode) || metadata.mode < 0)) throw new TypeError("file metadata mode is invalid");
    if (metadata.identity !== undefined && (typeof metadata.identity !== "string" || metadata.identity.length > 256 || metadata.identity.includes("\0"))) throw new TypeError("file metadata identity is invalid");
    this.sizeValue = metadata.size;
    this.diskIdentityValue = metadata.identity;
    this.diskMtimeMsValue = metadata.mtimeMs;
    this.diskModeValue = metadata.mode;
  }

  private clearHostMetadata(): void {
    this.diskIdentityValue = undefined;
    this.diskMtimeMsValue = undefined;
    this.diskModeValue = undefined;
  }

  private async readWholeForDraft(): Promise<Uint8Array> {
    if (this.diskBytes !== undefined) return copyBytes(this.diskBytes);
    if (this.storage.readFile !== undefined) {
      const bytes = await this.storage.readFile(this.canonicalPath);
      if (bytes.byteLength > this.maxDraftBytes) throw new FileServiceError("draft_too_large", "file exceeds the draft limit", { max: this.maxDraftBytes });
      return copyBytes(bytes);
    }
    if (this.storage.readRange === undefined) throw new Error("storage cannot read complete file for draft patch");
    const size = this.sizeValue;
    if (size === undefined || size > this.maxDraftBytes) throw new FileServiceError("draft_too_large", "file exceeds the draft limit", { max: this.maxDraftBytes });
    const bytes = await this.storage.readRange(this.canonicalPath, 0, size);
    if (bytes.byteLength > this.maxDraftBytes) throw new FileServiceError("draft_too_large", "file exceeds the draft limit", { max: this.maxDraftBytes });
    return copyBytes(bytes);
  }
}

type FileMutationFailure = { readonly ok: false; readonly error: FileServiceError };
type FileMutationFailureOrUndefined = FileMutationFailure | undefined;

export interface FileSessionRegistryOptions {
  readonly maxSessions?: number;
}

/** Keeps one canonical session per project-scoped path and retains dirty drafts
 * when a client disconnects. Hosts release entries only after panel lifecycle. */
export class FileSessionRegistry {
  private readonly sessions = new Map<string, FileSession>();
  private readonly maxSessions: number;

  constructor(options: FileSessionRegistryOptions = {}) {
    this.maxSessions = boundedLimit(options.maxSessions ?? 1024, "maxSessions");
  }

  open(canonicalPath: string, storage: FileSessionStorage, options?: FileSessionOptions): FileSession {
    const existing = this.sessions.get(canonicalPath);
    if (existing !== undefined) return existing;
    if (this.sessions.size >= this.maxSessions) throw new FileServiceError("draft_too_large", "file session limit reached", { max: this.maxSessions });
    const session = new FileSession(canonicalPath, storage, options);
    this.sessions.set(canonicalPath, session);
    return session;
  }

  get(canonicalPath: string): FileSession | undefined { return this.sessions.get(canonicalPath); }
  values(): readonly FileSession[] { return [...this.sessions.values()]; }
  release(canonicalPath: string, confirmDirty = false): FileMutationResult<FileSessionState> {
    const session = this.sessions.get(canonicalPath);
    if (session === undefined) return { ok: false, error: new FileServiceError("path_missing", "file session not found", { canonical: canonicalPath }) };
    if (session.dirty && !confirmDirty) return { ok: false, error: new FileServiceError("save_precondition", "dirty file requires explicit close confirmation") };
    if (session.dirty && confirmDirty) {
      const reloaded = session.reload({ confirm: true });
      if (reloaded instanceof Promise) return { ok: false, error: new FileServiceError("save_precondition", "asynchronous close requires releaseAsync") };
    }
    const closed = session.close();
    if (closed.ok) this.sessions.delete(canonicalPath);
    return closed;
  }

  async releaseAsync(canonicalPath: string, confirmDirty = false): Promise<FileMutationResult<FileSessionState>> {
    const session = this.sessions.get(canonicalPath);
    if (session === undefined) return { ok: false, error: new FileServiceError("path_missing", "file session not found", { canonical: canonicalPath }) };
    if (session.dirty && !confirmDirty) return { ok: false, error: new FileServiceError("save_precondition", "dirty file requires explicit close confirmation") };
    if (session.dirty) {
      const reloaded = await session.reload({ confirm: true });
      if (!reloaded.ok) return reloaded;
    }
    const closed = session.close();
    if (closed.ok) this.sessions.delete(canonicalPath);
    return closed;
  }

  /** Disconnecting clients does not release sessions; panel lifecycle must. */
  disconnect(): readonly FileSession[] { return this.values(); }
}

function copyBytes(bytes: Uint8Array): Uint8Array { return new Uint8Array(bytes); }

function boundedLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function boundedRevision(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}

function validateRange(offset: number, length: number, max: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) throw new FileServiceError("invalid_range", "byte range is invalid");
  if (length > max) throw new FileServiceError("range_too_large", "byte range exceeds the configured limit", { requested: String(length), max });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}
