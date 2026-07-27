import type { JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

export const FILE_VIEWER_OPERATIONS = Object.freeze({
  capabilities: "files.preview-metadata",
  open: "files.open",
  metadata: "files.metadata",
  readRange: "files.read-range",
  readText: "files.read-text",
  edit: "files.edit",
  save: "files.save",
  reload: "files.reload",
  keepLocal: "files.keep-local",
  close: "files.close",
  gitDiff: "file.get-git-diff",
  textMetadata: "file.text-metadata",
  textLines: "file.text-lines",
  saveSparse: "file.save-sparse",
});

export type FileViewerMode = "preview" | "text" | "hex" | "diff";
export type FileViewerPreviewKind = "markdown" | "image" | "pdf" | "text" | "hex" | "unsupported";

/** Content-free, server-authorized capability metadata for one file. */
export interface FileViewerCapabilities {
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs?: number;
  readonly mode?: number;
  readonly mimeType?: string;
  readonly previewKind: FileViewerPreviewKind;
  readonly preferredMode: "preview" | "text" | "hex";
  readonly isBinary: boolean;
  readonly isLargeFile: boolean;
  readonly safePreview: boolean;
  readonly canEditText: boolean;
  readonly canEditHex: boolean;
  readonly inspectedBytes: number;
  readonly inspectionTruncated: boolean;
  /** Optional because older servers did not publish Git capability metadata. */
  readonly canDiff?: boolean;
}

export interface FileViewerModeDecision {
  readonly mode: FileViewerMode;
  readonly requestedMode?: FileViewerMode;
  readonly reason?: "unavailable" | "server-preferred";
}

/** Select a viewer mode exclusively from the server capability snapshot. */
export function chooseFileViewerMode(capabilities: FileViewerCapabilities, requestedMode?: FileViewerMode): FileViewerModeDecision {
  const preferred = capabilities.preferredMode;
  const canUse = (mode: FileViewerMode): boolean => {
    if (mode === "preview") return capabilities.safePreview;
    if (mode === "text") return capabilities.canEditText;
    if (mode === "hex") return capabilities.canEditHex;
    return capabilities.canDiff === true;
  };
  if (requestedMode !== undefined && canUse(requestedMode)) return Object.freeze({ mode: requestedMode, requestedMode });
  if (requestedMode !== undefined) return Object.freeze({ mode: canUse(preferred) ? preferred : capabilities.canEditHex ? "hex" : "text", requestedMode, reason: "unavailable" });
  return Object.freeze({ mode: canUse(preferred) ? preferred : capabilities.canEditHex ? "hex" : "text", reason: "server-preferred" });
}

export interface FileTextMetadata {
  readonly indexedByteLength: number;
  readonly ino: number;
  readonly isComplete: boolean;
  readonly lineCount: number;
  readonly mtimeMs: number;
  readonly path: string;
  readonly size: number;
}

export interface FileTextLine {
  readonly end: number;
  readonly eol: "" | "\n" | "\r\n";
  readonly lineNumber: number;
  readonly start: number;
  readonly text: string;
}

export interface FileTextWindow {
  readonly lineCount: number;
  readonly lines: readonly FileTextLine[];
  readonly path: string;
  readonly startLine: number;
}

export interface FileSparseEdit {
  readonly dataBase64: string;
  readonly end: number;
  readonly start: number;
}

export interface FileSparseSaveRequest {
  readonly edits: readonly FileSparseEdit[];
  readonly expectedIno: number;
  readonly expectedMtimeMs: number;
  readonly expectedSize: number;
  readonly path: string;
  readonly projectRoot: string;
}

export interface FileViewerSessionIdentity {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly relativePath: string;
  readonly metadata: FileViewerSessionMetadata;
}

export interface FileViewerSessionMetadata {
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
  readonly watchState: "watching" | "conflict" | "unavailable" | "closed";
}

export interface FileViewerSessionRange {
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

/** Feature facade for the first server-owned file-viewer query. More file
 * operations can be added without exposing transport or host details to UI. */
export class FileViewerClient {
  constructor(private readonly transport: QueryCommandTransport) {}

  async getCapabilities(path: string, projectId?: string, options: QueryOptions = {}): Promise<FileViewerCapabilities> {
    const payload = { path: boundedPath(path, "file path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    return validateCapabilities(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.capabilities, payload, options));
  }

  async openFile(path: string, projectId?: string, options: QueryOptions = {}): Promise<FileViewerSessionIdentity> {
    const payload = { path: boundedPath(path, "file path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    return validateSessionIdentity(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.open, payload, options));
  }

  async readSessionRange(sessionId: string, offset: number, length: number, options: QueryOptions = {}): Promise<FileViewerSessionRange> {
    const payload = { sessionId: boundedPath(sessionId, "session id"), offset: boundedUInt(offset, "offset"), length: boundedPositiveUInt(length, "length", 1024 * 1024) };
    return validateSessionRange(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.readRange, payload, options));
  }

  async readSessionText(sessionId: string, offset: number, length: number, options: QueryOptions = {}): Promise<FileViewerSessionRange & { readonly text: string; readonly invalidEncoding: boolean }> {
    const payload = { sessionId: boundedPath(sessionId, "session id"), offset: boundedUInt(offset, "offset"), length: boundedPositiveUInt(length, "length", 1024 * 1024) };
    const value = await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.readText, payload, options);
    if (!isRecord(value) || typeof value.text !== "string" || typeof value.invalidEncoding !== "boolean") throw new TypeError("file session text response is invalid");
    return Object.freeze({ ...validateSessionRange(value), text: value.text, invalidEncoding: value.invalidEncoding });
  }

  async editSession(sessionId: string, text: string, expectedDraftRevision?: number, options: CommandOptions = {}): Promise<JsonValue> {
    const payload = { sessionId: boundedPath(sessionId, "session id"), text: boundedText(text, "draft text"), ...(expectedDraftRevision === undefined ? {} : { expectedDraftRevision: boundedUInt(expectedDraftRevision, "draft revision") }) };
    return this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.edit, payload, options);
  }

  async saveSession(sessionId: string, expectedDiskRevision?: number, expectedDraftRevision?: number, options: CommandOptions = {}): Promise<JsonValue> {
    const payload = { sessionId: boundedPath(sessionId, "session id"), ...(expectedDiskRevision === undefined ? {} : { expectedDiskRevision: boundedUInt(expectedDiskRevision, "disk revision") }), ...(expectedDraftRevision === undefined ? {} : { expectedDraftRevision: boundedUInt(expectedDraftRevision, "draft revision") }) };
    return this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.save, payload, options);
  }

  getGitDiff(path: string, options: QueryOptions = {}): Promise<JsonValue> {
    if (typeof path !== "string" || path.length === 0 || path.includes("\0")) throw new TypeError("file path is invalid");
    return this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.gitDiff, { path }, options);
  }

  async getTextMetadata(path: string, projectRoot: string, options: QueryOptions = {}): Promise<FileTextMetadata> {
    const payload = { path: boundedPath(path, "file path"), projectRoot: boundedPath(projectRoot, "project root") };
    return validateTextMetadata(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.textMetadata, payload, options));
  }

  async readTextLines(path: string, projectRoot: string, startLine: number, lineCount: number, options: QueryOptions = {}): Promise<FileTextWindow> {
    const payload = {
      path: boundedPath(path, "file path"),
      projectRoot: boundedPath(projectRoot, "project root"),
      startLine: boundedUInt(startLine, "start line"),
      lineCount: boundedPositiveUInt(lineCount, "line count", 512),
    };
    return validateTextWindow(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.textLines, payload, options));
  }

  async saveSparseFile(request: FileSparseSaveRequest, options: CommandOptions = {}): Promise<void> {
    const payload = validateSparseSaveRequest(request);
    await this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.saveSparse, payload, options);
  }
}

function boundedPath(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) throw new TypeError(`${name} is invalid`);
  return value;
}

function boundedUInt(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} is invalid`);
  return value;
}

function boundedPositiveUInt(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} is invalid`);
  return value;
}

function validateTextMetadata(value: JsonValue): FileTextMetadata {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length > 4096 || !safeUInt(value.indexedByteLength) || !safeUInt(value.ino) || typeof value.isComplete !== "boolean" || !safeUInt(value.lineCount) || !finiteNumber(value.mtimeMs) || !safeUInt(value.size) || value.indexedByteLength > value.size) throw new TypeError("file text metadata is invalid");
  return Object.freeze({ indexedByteLength: value.indexedByteLength, ino: value.ino, isComplete: value.isComplete, lineCount: value.lineCount, mtimeMs: value.mtimeMs, path: value.path, size: value.size });
}

function validateCapabilities(value: JsonValue): FileViewerCapabilities {
  if (!isRecord(value) || typeof value.relativePath !== "string" || value.relativePath.length > 4096 || !safeUInt(value.size) || !isPreviewKind(value.previewKind) || !isPreferredMode(value.preferredMode) || typeof value.isBinary !== "boolean" || typeof value.isLargeFile !== "boolean" || typeof value.safePreview !== "boolean" || typeof value.canEditText !== "boolean" || typeof value.canEditHex !== "boolean" || !safeUInt(value.inspectedBytes) || value.inspectedBytes > value.size || typeof value.inspectionTruncated !== "boolean" || (value.canDiff !== undefined && typeof value.canDiff !== "boolean")) throw new TypeError("file viewer capabilities are invalid");
  if (value.safePreview && value.previewKind === "unsupported") throw new TypeError("file viewer preview capability is inconsistent");
  return Object.freeze({ relativePath: value.relativePath, size: value.size, ...(finiteNumberOrUndefined(value.mtimeMs) === undefined ? {} : { mtimeMs: finiteNumberOrUndefined(value.mtimeMs) }), ...(safeUIntOrUndefined(value.mode) === undefined ? {} : { mode: safeUIntOrUndefined(value.mode) }), ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}), previewKind: value.previewKind, preferredMode: value.preferredMode, isBinary: value.isBinary, isLargeFile: value.isLargeFile, safePreview: value.safePreview, canEditText: value.canEditText, canEditHex: value.canEditHex, inspectedBytes: value.inspectedBytes, inspectionTruncated: value.inspectionTruncated, ...(value.canDiff === undefined ? {} : { canDiff: value.canDiff }) });
}

function validateSessionIdentity(value: JsonValue): FileViewerSessionIdentity {
  if (!isRecord(value) || typeof value.serverId !== "string" || typeof value.projectId !== "string" || typeof value.sessionId !== "string" || typeof value.relativePath !== "string" || !isRecord(value.metadata)) throw new TypeError("file session identity is invalid");
  return Object.freeze({ serverId: boundedPath(value.serverId, "server id"), projectId: boundedPath(value.projectId, "project id"), sessionId: boundedPath(value.sessionId, "session id"), relativePath: boundedPath(value.relativePath, "relative path"), metadata: validateSessionMetadata(value.metadata) });
}

function validateSessionMetadata(value: Record<string, JsonValue>): FileViewerSessionMetadata {
  if (typeof value.canonicalPath !== "string" || value.canonicalPath.length === 0 || value.canonicalPath.length > 4096 || !safeUInt(value.diskRevision) || !safeUInt(value.draftRevision) || typeof value.dirty !== "boolean" || typeof value.conflict !== "boolean" || !isWatchState(value.watchState) || (value.size !== undefined && !safeUInt(value.size)) || (value.draftSize !== undefined && !safeUInt(value.draftSize)) || (value.mtimeMs !== undefined && !finiteNumber(value.mtimeMs)) || (value.mode !== undefined && !safeUInt(value.mode)) || (value.diskIdentity !== undefined && (typeof value.diskIdentity !== "string" || value.diskIdentity.length > 256))) throw new TypeError("file session metadata is invalid");
  return Object.freeze({ canonicalPath: value.canonicalPath, ...(value.size === undefined ? {} : { size: value.size }), ...(value.draftSize === undefined ? {} : { draftSize: value.draftSize }), ...(value.mtimeMs === undefined ? {} : { mtimeMs: value.mtimeMs }), ...(value.mode === undefined ? {} : { mode: value.mode }), ...(value.diskIdentity === undefined ? {} : { diskIdentity: value.diskIdentity }), diskRevision: value.diskRevision, draftRevision: value.draftRevision, dirty: value.dirty, conflict: value.conflict, watchState: value.watchState });
}

function validateSessionRange(value: JsonValue): FileViewerSessionRange {
  if (!isRecord(value) || typeof value.canonicalPath !== "string" || !safeUInt(value.offset) || !safeUInt(value.requestedLength) || !safeUInt(value.diskRevision) || !safeUInt(value.draftRevision) || typeof value.dirty !== "boolean" || typeof value.conflict !== "boolean" || typeof value.bytes !== "string") throw new TypeError("file session range is invalid");
  const bytes = decodeBase64(value.bytes);
  if (bytes.byteLength > value.requestedLength) throw new TypeError("file session range exceeds request");
  if (value.totalSize !== undefined && !safeUInt(value.totalSize)) throw new TypeError("file session range size is invalid");
  return Object.freeze({ canonicalPath: boundedPath(value.canonicalPath, "canonical path"), offset: value.offset, requestedLength: value.requestedLength, bytes, ...(value.totalSize === undefined ? {} : { totalSize: value.totalSize }), diskRevision: value.diskRevision, draftRevision: value.draftRevision, dirty: value.dirty, conflict: value.conflict });
}

function decodeBase64(value: string): Uint8Array { if (value.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new TypeError("file bytes are invalid"); return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
function boundedText(value: string, name: string): string { if (typeof value !== "string" || value.length > 100 * 1024 * 1024) throw new RangeError(`${name} is invalid`); return value; }
function isPreviewKind(value: unknown): value is FileViewerPreviewKind { return value === "markdown" || value === "image" || value === "pdf" || value === "text" || value === "hex" || value === "unsupported"; }
function isPreferredMode(value: unknown): value is "preview" | "text" | "hex" { return value === "preview" || value === "text" || value === "hex"; }
function isWatchState(value: unknown): value is FileViewerSessionMetadata["watchState"] { return value === "watching" || value === "conflict" || value === "unavailable" || value === "closed"; }
function safeUIntOrUndefined(value: unknown): number | undefined { return value === undefined ? undefined : safeUInt(value) ? value : undefined; }
function finiteNumberOrUndefined(value: unknown): number | undefined { return value === undefined ? undefined : finiteNumber(value) ? value : undefined; }

function validateTextWindow(value: JsonValue): FileTextWindow {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length > 4096 || !safeUInt(value.lineCount) || !safeUInt(value.startLine) || !Array.isArray(value.lines) || value.lines.length > 512) throw new TypeError("file text window is invalid");
  const lines = value.lines.map((line) => {
    if (!isRecord(line) || !safeUInt(line.end) || !safeUInt(line.lineNumber) || !safeUInt(line.start) || line.end < line.start || typeof line.text !== "string" || line.text.length > 1024 * 1024 || (line.eol !== "" && line.eol !== "\n" && line.eol !== "\r\n")) throw new TypeError("file text line is invalid");
    return Object.freeze({ end: line.end, eol: line.eol, lineNumber: line.lineNumber, start: line.start, text: line.text });
  });
  return Object.freeze({ lineCount: value.lineCount, lines: Object.freeze(lines), path: value.path, startLine: value.startLine });
}

function validateSparseSaveRequest(request: FileSparseSaveRequest): JsonValue {
  const path = boundedPath(request.path, "file path");
  const projectRoot = boundedPath(request.projectRoot, "project root");
  if (!Array.isArray(request.edits) || request.edits.length > 4096) throw new RangeError("file edits are invalid");
  if (!safeUInt(request.expectedIno) || !finiteNumber(request.expectedMtimeMs) || !safeUInt(request.expectedSize)) throw new TypeError("file revision is invalid");
  let previousEnd = 0;
  const edits = request.edits.map((edit) => {
    if (typeof edit.dataBase64 !== "string" || edit.dataBase64.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(edit.dataBase64) || !safeUInt(edit.start) || !safeUInt(edit.end) || edit.end <= edit.start || edit.start < previousEnd) throw new TypeError("file edit is invalid");
    previousEnd = edit.end;
    return { dataBase64: edit.dataBase64, end: edit.end, start: edit.start };
  });
  return { edits, expectedIno: request.expectedIno, expectedMtimeMs: request.expectedMtimeMs, expectedSize: request.expectedSize, path, projectRoot };
}

function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeUInt(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function finiteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
