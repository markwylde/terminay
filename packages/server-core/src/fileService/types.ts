/** The path and file services intentionally depend on these small interfaces
 * rather than on Electron, IPC, or a particular server transport. */

export type MaybePromise<T> = T | PromiseLike<T>;

export interface PathStat {
  readonly isDirectory?: boolean;
  readonly isFile?: boolean;
  readonly isSymbolicLink?: boolean;
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly mode?: number;
}

export interface CanonicalPathAdapter {
  /** Resolve all links in `path`, as the server's filesystem sees them. */
  readonly realpath: (path: string) => MaybePromise<string>;
  /** Stat the resolved path. `lstat` is useful for rejecting dangling links. */
  readonly stat: (path: string) => MaybePromise<PathStat>;
  readonly lstat?: (path: string) => MaybePromise<PathStat>;
}

export interface FileMetadata {
  readonly size: number;
  readonly mtimeMs?: number;
  readonly mode?: number;
  /** A host supplied opaque identity (for example an inode plus mtime). */
  readonly identity?: string;
}

export interface FileSessionStorage {
  /** Read at most `length` bytes beginning at `offset`. */
  readonly readRange?: (path: string, offset: number, length: number, signal?: AbortSignal) => MaybePromise<Uint8Array>;
  /** Optional whole-file fallback for small files and draft patches. */
  readonly readFile?: (path: string, signal?: AbortSignal) => MaybePromise<Uint8Array>;
  readonly stat?: (path: string, signal?: AbortSignal) => MaybePromise<FileMetadata>;
  /** Must replace the destination atomically, or throw without changing it. */
  readonly atomicWrite: (path: string, bytes: Uint8Array, signal?: AbortSignal) => MaybePromise<void>;
}

export type FileWatchState = "watching" | "conflict" | "unavailable" | "closed";

export interface FileSessionState {
  readonly canonicalPath: string;
  readonly diskRevision: number;
  readonly draftRevision: number;
  /** Draft revision which was last confirmed against disk. */
  readonly baseDraftRevision: number;
  /** Disk revision from which the retained draft was derived. */
  readonly draftBaseDiskRevision: number;
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly watchState: FileWatchState;
  readonly size?: number;
  readonly draftSize?: number;
  readonly diskIdentity?: string;
}

/**
 * Bounded metadata returned by a server-owned file session.
 *
 * This intentionally contains no file bytes or client supplied path aliases.
 * Optional fields remain omitted when the host cannot provide them rather than
 * inventing metadata for a remote filesystem.
 */
export interface FileSessionMetadata {
  readonly canonicalPath: string;
  readonly size?: number;
  readonly draftSize?: number;
  readonly mtimeMs?: number;
  readonly mode?: number;
  readonly diskIdentity?: string;
  readonly diskRevision: number;
  readonly draftRevision: number;
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly watchState: FileWatchState;
}

export interface FileReadRange {
  readonly canonicalPath: string;
  readonly offset: number;
  readonly requestedLength: number;
  readonly bytes: Uint8Array;
  readonly totalSize?: number;
  readonly diskRevision: number;
  readonly draftRevision: number;
  readonly dirty: boolean;
  readonly conflict: boolean;
}

export interface FileSessionOptions {
  readonly initialBytes?: Uint8Array;
  readonly initialMetadata?: FileMetadata;
  readonly diskRevision?: number;
  readonly maxRangeBytes?: number;
  readonly maxDraftBytes?: number;
}

export interface ExternalDiskChange {
  readonly bytes?: Uint8Array;
  readonly metadata?: FileMetadata;
  /** A supplied revision must be greater than the session's current revision. */
  readonly diskRevision?: number;
}

export interface SaveOptions {
  readonly expectedDiskRevision?: number;
  readonly expectedDraftRevision?: number;
}

export interface ReloadOptions {
  /** Reload is destructive to a dirty draft and therefore requires consent. */
  readonly confirm?: boolean;
  readonly expectedDiskRevision?: number;
  readonly expectedDraftRevision?: number;
}

export type FileServiceErrorCode =
  | "invalid_path"
  | "path_escape"
  | "path_missing"
  | "not_directory"
  | "not_file"
  | "invalid_range"
  | "range_too_large"
  | "draft_too_large"
  | "revision_conflict"
  | "save_precondition"
  | "not_dirty"
  | "confirmation_required"
  | "session_closed"
  | "write_failed"
  /** A directory entry could not be read after the project scope was authorized. */
  | "read_failed";

export interface FileServiceErrorDetails {
  readonly expected?: number;
  readonly actual?: number;
  readonly requested?: string;
  readonly canonical?: string;
  readonly max?: number;
}

export class FileServiceError extends Error {
  readonly code: FileServiceErrorCode;
  readonly details: FileServiceErrorDetails | undefined;

  constructor(code: FileServiceErrorCode, message: string, details?: FileServiceErrorDetails) {
    super(message);
    this.name = "FileServiceError";
    this.code = code;
    this.details = details;
  }
}

export type FileMutationSuccess<T> = { readonly ok: true; readonly value: T };
export type FileMutationFailure = { readonly ok: false; readonly error: FileServiceError };
export type FileMutationResult<T> = FileMutationSuccess<T> | FileMutationFailure;
