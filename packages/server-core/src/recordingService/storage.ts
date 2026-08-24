import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_RECORDING_ROOT,
  RECORDING_ID_PATTERN,
  RecordingServiceError,
  type RecordingChunk,
  type RecordingChunkRequest,
  type RecordingMetadata,
  type RecordingRootReference,
  type RecordingStorage,
  type RecordingStorageEntry,
} from "./types.js";

interface StorageOptions {
  readonly recordingRoot: string;
  readonly homeDirectory: string;
  readonly libraryIndexPath?: string;
  readonly migrateStoredMetadata?: (metadata: RecordingMetadata) => RecordingMetadata;
}

const MAX_HEADER_BYTES = 64 * 1024;

function privateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Windows has no POSIX mode bits. */ }
}

function privateFile(filePath: string): void {
  try { chmodSync(filePath, 0o600); } catch { /* Windows has no POSIX mode bits. */ }
}

function atomicJsonWrite(filePath: string, value: unknown): void {
  privateDirectory(path.dirname(filePath));
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    const bytes = Buffer.from(JSON.stringify(value, null, 2), "utf8");
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, filePath);
    privateFile(filePath);
    try {
      const directoryDescriptor = openSync(path.dirname(filePath), "r");
      try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    } catch { /* directory fsync is unavailable on some hosts */ }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function canonicalizePotentialPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  let ancestor = resolved;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return resolved;
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), path.relative(ancestor, resolved));
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch { return null; }
}

function safeInteger(value: unknown, fallback: number, minimum = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function safeString(value: unknown, fallback: string | null = null): string | null {
  return typeof value === "string" ? value : fallback;
}

function validDate(value: unknown, fallback: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function normalizeMetadata(value: Record<string, unknown>, root: string, fallbackId?: string): RecordingMetadata | null {
  const recordingId = typeof value.recordingId === "string" ? value.recordingId : fallbackId;
  if (recordingId === undefined || !RECORDING_ID_PATTERN.test(recordingId)) return null;
  const state = value.recordingState === "recording" || value.recordingState === "completed" || value.recordingState === "interrupted" || value.recordingState === "failed"
    ? value.recordingState : "completed";
  const startedAt = validDate(value.startedAt, new Date(0).toISOString());
  const endedAt = typeof value.endedAt === "string" && !Number.isNaN(Date.parse(value.endedAt)) ? new Date(value.endedAt).toISOString() : null;
  const relativeCastPath = typeof value.relativeCastPath === "string" && !path.isAbsolute(value.relativeCastPath)
    ? value.relativeCastPath : `${recordingId}.cast`;
  const candidateCast = path.resolve(root, relativeCastPath);
  if (!isWithin(path.resolve(root), candidateCast) || !candidateCast.endsWith(".cast")) return null;
  const castSize = safeInteger(value.castSize ?? value.bytesWritten, 0);
  const inputPolicy = value.inputPolicy === "record-with-sensitive-filter" ? "record-with-sensitive-filter" : "none";
  const sensitive = value.sensitiveInputPolicy === "mask" ? "mask" : "drop";
  return {
    version: 3,
    recordingId,
    sessionId: safeString(value.sessionId, "") ?? "",
    serverId: safeString(value.serverId),
    projectId: safeString(value.projectId),
    projectName: safeString(value.projectName ?? value.projectTitle),
    projectRoot: safeString(value.projectRoot),
    title: safeString(value.title, "Terminal Recording") ?? "Terminal Recording",
    note: safeString(value.note),
    color: safeString(value.color),
    emoji: safeString(value.emoji),
    cwd: safeString(value.cwd),
    shell: safeString(value.shell),
    cols: Math.max(2, safeInteger(value.cols, 80, 2)),
    rows: Math.max(1, safeInteger(value.rows, 24, 1)),
    finalCols: value.finalCols === null ? null : Math.max(2, safeInteger(value.finalCols, safeInteger(value.cols, 80, 2), 2)),
    finalRows: value.finalRows === null ? null : Math.max(1, safeInteger(value.finalRows, safeInteger(value.rows, 24, 1), 1)),
    startedAt,
    endedAt,
    durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0 ? value.durationMs : null,
    exitCode: typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) ? value.exitCode : null,
    signal: typeof value.signal === "number" && Number.isSafeInteger(value.signal) && value.signal > 0 ? value.signal : null,
    recordingState: state,
    capturedInput: value.capturedInput === true,
    inputPolicy,
    sensitiveInputPolicy: sensitive,
    eventCount: safeInteger(value.eventCount, 0),
    bytesWritten: safeInteger(value.bytesWritten, castSize),
    relativeCastPath: path.relative(root, candidateCast),
    castSize,
    format: "asciicast",
    formatVersion: 3,
    errorMessage: value.errorMessage === null ? null : (value.errorMessage === "The recording could not be written." ? value.errorMessage : null),
  };
}

function readHeader(castPath: string): Record<string, unknown> | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(castPath, "r");
    const buffer = Buffer.allocUnsafe(MAX_HEADER_BYTES);
    const read = readSync(descriptor, buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, read).indexOf(0x0a);
    if (newline < 0) return null;
    return parseObject(buffer.subarray(0, newline).toString("utf8"));
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function metadataFromCast(castPath: string, root: string, now: Date): RecordingMetadata {
  let stat: ReturnType<typeof statSync>;
  try { stat = statSync(castPath); } catch { throw new RecordingServiceError("not_found", "Recording cast does not exist."); }
  const id = path.basename(castPath, ".cast");
  const header = readHeader(castPath);
  const term = typeof header?.term === "object" && header.term !== null ? header.term as Record<string, unknown> : {};
  const timestamp = typeof header?.timestamp === "number" && Number.isFinite(header.timestamp) ? header.timestamp * 1000 : stat.birthtimeMs;
  const startedAt = new Date(timestamp).toISOString();
  return {
    version: 3,
    recordingId: RECORDING_ID_PATTERN.test(id) ? id : randomUUID(),
    sessionId: "",
    serverId: null,
    projectId: null,
    projectName: null,
    projectRoot: null,
    title: typeof header?.title === "string" ? header.title.slice(0, 512) : "Incomplete terminal recording",
    note: null,
    color: null,
    emoji: null,
    cwd: null,
    shell: null,
    cols: Math.max(2, safeInteger(term.cols, 80, 2)),
    rows: Math.max(1, safeInteger(term.rows, 24, 1)),
    finalCols: null,
    finalRows: null,
    startedAt,
    endedAt: now.toISOString(),
    durationMs: Math.max(0, now.getTime() - timestamp),
    exitCode: null,
    signal: null,
    recordingState: "interrupted",
    capturedInput: false,
    inputPolicy: "none",
    sensitiveInputPolicy: "drop",
    eventCount: 0,
    bytesWritten: stat.size,
    relativeCastPath: path.relative(root, castPath),
    castSize: stat.size,
    format: "asciicast",
    formatVersion: 3,
    errorMessage: null,
  };
}

/** Node filesystem implementation; no path is exposed by the public service. */
export class NodeRecordingStorage implements RecordingStorage {
  private readonly rootSet = new Set<string>();
  private readonly indexPath: string;
  private readonly migrateStoredMetadata: ((metadata: RecordingMetadata) => RecordingMetadata) | undefined;

  constructor(options: StorageOptions) {
    const root = this.expandRoot(options.recordingRoot, options.homeDirectory);
    this.indexPath = options.libraryIndexPath ?? path.join(options.homeDirectory, ".terminay", "recording-roots.json");
    this.migrateStoredMetadata = options.migrateStoredMetadata;
    this.loadRoots();
    this.registerRoot(root, false);
    this.persistRoots();
  }

  get roots(): readonly string[] { return [...this.rootSet]; }

  registerRoot(rawRoot: string, create = true): string {
    if (typeof rawRoot !== "string" || rawRoot.trim().length === 0 || rawRoot.includes("\0")) throw new RecordingServiceError("invalid_root", "Recording root is invalid.");
    const candidate = this.expandRoot(rawRoot, path.dirname(this.indexPath));
    const canonicalCandidate = canonicalizePotentialPath(candidate);
    if (create) privateDirectory(canonicalCandidate);
    const canonical = existsSync(canonicalCandidate) ? realpathSync(canonicalCandidate) : path.resolve(canonicalCandidate);
    this.rootSet.add(canonical);
    this.persistRoots();
    return canonical;
  }

  describeRoot(rawRoot: string, create = false): RecordingRootReference {
    const canonical = this.registerRoot(rawRoot, create);
    let available = false;
    try {
      readdirSync(canonical, { withFileTypes: true });
      available = true;
    } catch { /* retain the root reference while a volume is unavailable */ }
    const recordingIds = new Set<string>();
    if (available) {
      for (const entry of this.list()) {
        if (isWithin(canonical, path.resolve(entry.castPath))) recordingIds.add(entry.metadata.recordingId);
      }
    }
    return { rootId: opaqueRootId(canonical), available, recordingCount: recordingIds.size };
  }

  createRecording(metadata: RecordingMetadata, header: string): RecordingStorageEntry {
    if (!RECORDING_ID_PATTERN.test(metadata.recordingId)) throw new RecordingServiceError("invalid_id", "Recording id is invalid.");
    const root = this.registerRoot(this.rootForNewRecording(), true);
    const date = metadata.startedAt.slice(0, 10);
    const directory = path.join(root, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "unknown-date");
    privateDirectory(directory);
    const castPath = path.join(directory, `${metadata.recordingId}.cast`);
    const metadataPath = path.join(directory, `${metadata.recordingId}.json`);
    if (existsSync(castPath) || existsSync(metadataPath)) throw new RecordingServiceError("storage_failed", "Recording id already exists.");
    let descriptor: number | undefined;
    try {
      descriptor = openSync(castPath, "wx", 0o600);
      writeFileSync(descriptor, header.endsWith("\n") ? header : `${header}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      privateFile(castPath);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(castPath, { force: true });
      throw new RecordingServiceError("storage_failed", error instanceof Error ? error.message : "Unable to create recording cast.");
    }
    const entry: RecordingStorageEntry = { metadata, castPath };
    try { this.writeMetadata(entry, metadata); } catch (error) { rmSync(castPath, { force: true }); throw error; }
    return entry;
  }

  append(entry: RecordingStorageEntry, text: string): void {
    const canonical = this.authorizeCastPath(entry.castPath);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(canonical, "a", 0o600);
      writeFileSync(descriptor, text, "utf8");
      fsyncSync(descriptor);
    } catch (error) {
      throw new RecordingServiceError("storage_failed", error instanceof Error ? error.message : "Unable to append recording.");
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }

  writeMetadata(entry: RecordingStorageEntry, metadata: RecordingMetadata): void {
    const castPath = this.authorizeCastPath(entry.castPath);
    const metadataPath = castPath.replace(/\.cast$/i, ".json");
    try { atomicJsonWrite(metadataPath, metadata); } catch (error) {
      throw new RecordingServiceError("storage_failed", error instanceof Error ? error.message : "Unable to write recording metadata.");
    }
  }

  readMetadata(entry: RecordingStorageEntry): RecordingMetadata | null {
    const castPath = this.authorizeCastPath(entry.castPath);
    const metadataPath = castPath.replace(/\.cast$/i, ".json");
    try {
      const parsed = parseObject(readFileSync(metadataPath, "utf8"));
      const metadata = parsed === null ? null : normalizeMetadata(parsed, this.authorizedRoot(castPath), path.basename(castPath, ".cast"));
      if (metadata === null || this.migrateStoredMetadata === undefined) return metadata;
      const migrated = this.migrateStoredMetadata(metadata);
      if (migrated !== metadata) this.writeMetadata({ metadata, castPath }, migrated);
      return migrated;
    } catch { return null; }
  }

  list(): readonly RecordingStorageEntry[] {
    const found = new Map<string, RecordingStorageEntry>();
    const now = new Date();
    for (const root of this.rootSet) {
      if (!existsSync(root)) continue;
      for (const filePath of this.walk(root)) {
        if (!filePath.endsWith(".cast")) continue;
        let metadata = this.readMetadata({ metadata: {} as RecordingMetadata, castPath: filePath });
        if (metadata === null) {
          metadata = metadataFromCast(filePath, root, now);
          try { this.writeMetadata({ metadata, castPath: filePath }, metadata); } catch { /* read-only recovery remains usable */ }
        }
        const canonical = this.authorizeCastPath(filePath);
        if (!found.has(metadata.recordingId)) found.set(metadata.recordingId, { metadata, castPath: canonical });
      }
      for (const filePath of this.walk(root)) {
        if (!filePath.endsWith(".json")) continue;
        try {
          const parsed = parseObject(readFileSync(filePath, "utf8"));
          if (parsed === null) continue;
          const castPath = path.join(path.dirname(filePath), `${path.basename(filePath, ".json")}.cast`);
          if (!existsSync(castPath)) {
            const metadata = normalizeMetadata(parsed, root, path.basename(filePath, ".json"));
            if (metadata !== null && !found.has(metadata.recordingId)) {
              const unavailable = metadata.recordingState === "recording" ? { ...metadata, recordingState: "interrupted" as const, endedAt: metadata.endedAt ?? new Date().toISOString() } : metadata;
              found.set(metadata.recordingId, { metadata: unavailable, castPath });
            }
          }
        } catch { /* malformed sidecars do not take down the timeline */ }
      }
    }
    return [...found.values()];
  }

  readChunk(entry: RecordingStorageEntry, request: RecordingChunkRequest, maxChunkBytes: number): RecordingChunk {
    const signal = request.signal;
    if (signal?.aborted) throw new RecordingServiceError("aborted", "Recording read was canceled.");
    const start = request.start ?? 0;
    const maxBytes = request.maxBytes ?? Math.min(64 * 1024, maxChunkBytes);
    if (!Number.isSafeInteger(start) || start < 0) throw new RecordingServiceError("invalid_offset", "Recording chunk offset is invalid.");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > maxChunkBytes) throw new RecordingServiceError("chunk_limit", `Recording chunk size must be between 1 and ${maxChunkBytes} bytes.`);
    const castPath = this.authorizeCastPath(entry.castPath);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(castPath, "r");
      const totalSize = statSync(castPath).size;
      if (start > totalSize) throw new RecordingServiceError("invalid_offset", "Recording chunk offset is beyond the end.");
      if (start > 0) {
        const preceding = Buffer.allocUnsafe(1);
        const result = readSync(descriptor, preceding, 0, 1, start - 1);
        if (result !== 1 || preceding[0] !== 0x0a) throw new RecordingServiceError("invalid_offset", "Recording chunk offset is not a record boundary.");
      }
      if (start === totalSize) return { recordingId: request.recordingId, start, nextOffset: start, totalSize, content: "", eof: true, incompleteTail: false };
      const buffer = Buffer.allocUnsafe(Math.min(maxBytes, totalSize - start));
      const count = readSync(descriptor, buffer, 0, buffer.length, start);
      if (signal?.aborted) throw new RecordingServiceError("aborted", "Recording read was canceled.");
      const bytes = buffer.subarray(0, count);
      const newline = bytes.lastIndexOf(0x0a);
      if (newline < 0) {
        if (start + count < totalSize) throw new RecordingServiceError("chunk_limit", `An asciicast record exceeds the ${maxBytes} byte chunk limit.`);
        const active = entry.metadata.recordingState === "recording";
        return { recordingId: request.recordingId, start, nextOffset: active ? start : totalSize, totalSize, content: "", eof: !active, incompleteTail: true };
      }
      const complete = bytes.subarray(0, newline + 1);
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(complete); }
      catch { throw new RecordingServiceError("malformed_recording", "Recording contains invalid UTF-8."); }
      const nextOffset = start + complete.byteLength;
      return { recordingId: request.recordingId, start, nextOffset, totalSize, content, eof: nextOffset >= totalSize, incompleteTail: nextOffset < totalSize };
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }

  delete(entry: RecordingStorageEntry): void {
    const castPath = this.authorizeCastPath(entry.castPath);
    if (entry.metadata.recordingState === "recording") throw new RecordingServiceError("active_recording", "Stop the active recording before deleting it.");
    try {
      rmSync(castPath, { force: true });
      rmSync(castPath.replace(/\.cast$/i, ".json"), { force: true });
    } catch (error) { throw new RecordingServiceError("storage_failed", error instanceof Error ? error.message : "Unable to delete recording."); }
  }

  recover(now: Date): void {
    for (const entry of this.list()) {
      if (entry.metadata.recordingState !== "recording") continue;
      const metadata: RecordingMetadata = { ...entry.metadata, recordingState: "interrupted", endedAt: now.toISOString(), durationMs: Math.max(0, now.getTime() - Date.parse(entry.metadata.startedAt)), castSize: this.castSize(entry.castPath), bytesWritten: this.castSize(entry.castPath) };
      try { this.writeMetadata(entry, metadata); } catch { /* remain discoverable with the last valid sidecar */ }
    }
  }

  close(): void { /* writes are synchronous; kept for lifecycle composition */ }

  private rootForNewRecording(): string {
    const first = [...this.rootSet][this.rootSet.size - 1];
    if (first === undefined) throw new RecordingServiceError("invalid_root", "No recording root is configured.");
    return first;
  }

  private expandRoot(rawRoot: string, homeDirectory: string): string {
    const trimmed = rawRoot.trim() || DEFAULT_RECORDING_ROOT;
    if (trimmed === "~") return homeDirectory;
    if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return path.join(homeDirectory, trimmed.slice(2));
    return path.isAbsolute(trimmed) ? trimmed : path.join(homeDirectory, trimmed);
  }

  private loadRoots(): void {
    try {
      const object = parseObject(readFileSync(this.indexPath, "utf8"));
      if (!Array.isArray(object?.roots)) return;
      for (const root of object.roots) if (typeof root === "string" && path.isAbsolute(root)) this.rootSet.add(existsSync(root) ? realpathSync(root) : path.resolve(root));
    } catch { /* optional index */ }
  }

  private persistRoots(): void {
    try { atomicJsonWrite(this.indexPath, { version: 1, roots: [...this.rootSet] }); } catch { /* recording itself remains usable */ }
  }

  private walk(root: string): string[] {
    const output: string[] = [];
    let entries: Array<{ readonly name: string; isDirectory(): boolean; isFile(): boolean }>;
    try { entries = readdirSync(root, { withFileTypes: true }) as unknown as Array<{ readonly name: string; isDirectory(): boolean; isFile(): boolean }>; } catch { return output; }
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) output.push(...this.walk(entryPath));
      else if (entry.isFile() && (entry.name.endsWith(".cast") || entry.name.endsWith(".json"))) output.push(entryPath);
    }
    return output;
  }

  private authorizedRoot(castPath: string): string {
    const resolved = path.resolve(castPath);
    const root = [...this.rootSet].find((candidate) => isWithin(path.resolve(candidate), resolved));
    if (root === undefined) throw new RecordingServiceError("path_escape", "Recording file is outside the recordings library.");
    return path.resolve(root);
  }

  private authorizeCastPath(castPath: string): string {
    if (typeof castPath !== "string" || !castPath.endsWith(".cast")) throw new RecordingServiceError("path_escape", "Recording file is not authorized.");
    const canonical = path.resolve(castPath);
    const root = this.authorizedRoot(canonical);
    if (!isWithin(root, canonical)) throw new RecordingServiceError("path_escape", "Recording file is outside the recordings library.");
    if (!existsSync(canonical)) throw new RecordingServiceError("not_found", "Recording cast does not exist.");
    try {
      const real = realpathSync(canonical);
      const realRoot = existsSync(root) ? realpathSync(root) : root;
      if (!isWithin(realRoot, real)) throw new RecordingServiceError("path_escape", "Recording file is outside the recordings library.");
      return real;
    } catch (error) {
      if (error instanceof RecordingServiceError) throw error;
      throw new RecordingServiceError("not_found", "Recording cast does not exist.");
    }
  }

  private castSize(castPath: string): number {
    try { return statSync(castPath).size; } catch { return 0; }
  }
}

function opaqueRootId(value: string): string {
  // Stable path-free reference for the library index API. It is not an
  // authorization credential; filesystem access still resolves roots here.
  let hash = 2166136261;
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `root-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
