import { MAX_FILE_CONTENT_RANGE_BYTES, type JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { BinaryQueryTransport, QueryCommandTransport } from "./queryCommand.js";

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
  contentCapabilities: "files.content-capabilities",
  contentRange: "files.content-range",
  contentText: "files.content-text",
  contentHex: "files.content-hex",
  contentPreview: "files.content-preview",
  gitDiff: "file.get-git-diff",
  textMetadata: "file.text-metadata",
  textLines: "file.text-lines",
  saveSparse: "file.save-sparse",
  list: "files.list",
  search: "files.search",
  createFile: "files.create",
  createDirectory: "files.create-directory",
  rename: "files.rename",
  delete: "files.delete",
  folderTasks: "files.tasks",
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

export type FileViewerContentKind = "text" | "markdown" | "image" | "pdf" | "binary";

export interface FileViewerContentCapabilities {
  readonly relativePath: string;
  readonly size: number;
  readonly kind: FileViewerContentKind;
  readonly contentType: string;
  readonly isLarge: boolean;
  readonly canPreview: boolean;
  readonly canText: boolean;
  readonly canHex: boolean;
  readonly maxDecodedImagePixels: number;
}

export interface FileViewerContentRange {
  readonly relativePath: string;
  readonly kind: FileViewerContentKind;
  readonly contentType: string;
  readonly offset: number;
  readonly requestedLength: number;
  readonly bytes: Uint8Array;
  readonly totalSize: number;
  readonly truncated: boolean;
}

export type FileViewerContentStreamMode = "range" | "preview";

export interface FileViewerContentStreamOptions {
  readonly mode?: FileViewerContentStreamMode;
  readonly startOffset?: number;
  readonly chunkBytes?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface FileViewerContentStreamChunk extends FileViewerContentRange {
  /** Server-authorized decoded-image limit carried alongside every chunk. */
  readonly decodedImagePixelLimit: number;
  /** True only when this chunk ends a bounded, incomplete transfer. */
  readonly streamTruncated: boolean;
}

export interface FileViewerContentStreamState {
  /** Next byte to request when the transfer is resumed. */
  readonly nextOffset: number;
  readonly bytesTransferred: number;
  /** True once the complete file has been acknowledged by the iterator. */
  readonly complete: boolean;
  /** True when the byte cap, an interrupted range, or a short source stopped the transfer. */
  readonly truncated: boolean;
}

export type FileCatalogEntryKind = "file" | "directory" | "symlink" | "other";

export interface FileCatalogEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: FileCatalogEntryKind;
  readonly isSymbolicLink: boolean;
  readonly accessible: boolean;
  readonly size: number;
  readonly mtimeMs?: number;
  readonly mode?: number;
}

export interface FileCatalogPage {
  readonly root: string;
  readonly offset: number;
  readonly entries: readonly FileCatalogEntry[];
  readonly nextOffset?: number;
  readonly truncated: boolean;
}

export interface FileCatalogSearchPage {
  readonly root: string;
  readonly query: string;
  readonly results: readonly (FileCatalogEntry & { readonly score: number })[];
  readonly scannedEntries: number;
  readonly truncated: boolean;
}

export interface FileViewerContentStream {
  readonly capabilities: FileViewerContentCapabilities;
  readonly state: FileViewerContentStreamState;
  readonly chunks: AsyncIterable<FileViewerContentStreamChunk>;
}

export interface FileViewerHexRow {
  readonly offset: number;
  readonly hex: string;
  readonly ascii: string;
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
  readonly indexedByteLength?: number;
  readonly indexComplete?: boolean;
  readonly lineCount: number;
  readonly lines: readonly FileTextLine[];
  readonly path: string;
  readonly startLine: number;
  readonly windowComplete?: boolean;
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

export interface FolderMarkdownTaskItem {
  readonly id: string;
  readonly relativePath: string;
  readonly lineNumber: number;
  readonly label: string;
  readonly checked: boolean;
  readonly depth: number;
  readonly sectionPath: readonly string[];
}

export interface FolderMarkdownTaskStats {
  readonly total: number;
  readonly completed: number;
  readonly remaining: number;
}

export interface FolderMarkdownTaskSection {
  readonly id: string;
  readonly title: string | null;
  readonly level: number;
  readonly tasks: readonly FolderMarkdownTaskItem[];
  readonly children: readonly FolderMarkdownTaskSection[];
}

export interface FolderMarkdownTaskFile {
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs?: number;
  readonly sections: readonly FolderMarkdownTaskSection[];
  readonly tasks: readonly FolderMarkdownTaskItem[];
  readonly stats: FolderMarkdownTaskStats;
  readonly truncated: boolean;
  readonly invalidEncoding: boolean;
}

export interface FolderMarkdownTaskAggregation {
  readonly root: string;
  readonly files: readonly FolderMarkdownTaskFile[];
  readonly tasks: readonly FolderMarkdownTaskItem[];
  readonly stats: FolderMarkdownTaskStats;
  readonly scannedEntries: number;
  readonly scannedFiles: number;
  readonly readBytes: number;
  readonly truncated: boolean;
}

export interface FolderMarkdownTaskOptions {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  readonly maxTasks?: number;
  readonly maxFileBytes?: number;
  readonly maxTaskLabelLength?: number;
  readonly ignoredDirectories?: readonly string[];
}

const DEFAULT_CONTENT_STREAM_CHUNK_BYTES = 256 * 1024;
const DEFAULT_CONTENT_STREAM_MAX_BYTES = 8 * 1024 * 1024;
const MAX_CONTENT_STREAM_CHUNK_BYTES = MAX_FILE_CONTENT_RANGE_BYTES;
const MAX_CONTENT_STREAM_BYTES = 128 * 1024 * 1024;

/** Feature facade for the first server-owned file-viewer query. More file
 * operations can be added without exposing transport or host details to UI. */
export class FileViewerClient {
  constructor(private readonly transport: QueryCommandTransport) {}

  async getCapabilities(path: string, projectId?: string, options: QueryOptions = {}): Promise<FileViewerCapabilities> {
    const payload = { path: boundedPath(path, "file path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    return validateCapabilities(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.capabilities, payload, options));
  }

  async listFolder(path: string, projectId?: string, options: QueryOptions = {}): Promise<FileCatalogPage> {
    const payload = { path: boundedPath(path, "folder path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    return validateCatalogPage(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.list, payload, options));
  }

  async createDirectory(path: string, projectId?: string, options: CommandOptions = {}): Promise<void> {
    const payload = { path: boundedPath(path, "folder path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    await this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.createDirectory, payload, options);
  }

  async createFile(path: string, bytes = new Uint8Array(), projectId?: string, options: CommandOptions = {}): Promise<void> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 4 * 1024 * 1024) throw new RangeError("file creation bytes are invalid");
    const payload = {
      path: boundedPath(path, "file path"),
      bytesBase64: bytesToBase64(bytes),
      ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }),
    };
    await this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.createFile, payload, options);
  }

  async searchFolder(path: string, query: string, projectId?: string, options: QueryOptions & { readonly limit?: number } = {}): Promise<FileCatalogSearchPage> {
    if (typeof query !== "string" || query.length === 0 || query.length > 256 || query.includes("\0")) throw new TypeError("file search query is invalid");
    const limit = options.limit ?? 60;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) throw new RangeError("file search limit is invalid");
    const payload = { path: boundedPath(path, "folder path"), query, options: { limit }, ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    return validateCatalogSearchPage(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.search, payload, options));
  }

  async renameEntry(path: string, destination: string, projectId?: string, options: CommandOptions = {}): Promise<void> {
    const payload = { path: boundedPath(path, "file path"), destination: boundedPath(destination, "destination path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    await this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.rename, payload, options);
  }

  async deleteEntry(path: string, recursive = false, projectId?: string, options: CommandOptions = {}): Promise<void> {
    const payload = { path: boundedPath(path, "file path"), recursive, ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    await this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.delete, payload, options);
  }

  async getContentCapabilities(path: string, projectId?: string, options: QueryOptions = {}): Promise<FileViewerContentCapabilities> {
    const payload = { path: boundedPath(path, "file path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    return validateContentCapabilities(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.contentCapabilities, payload, options));
  }

  async readContentRange(path: string, offset: number, length: number, projectId?: string, options: QueryOptions = {}): Promise<FileViewerContentRange> {
    const payload = { path: boundedPath(path, "file path"), offset: boundedUInt(offset, "offset"), length: boundedPositiveUInt(length, "length", MAX_FILE_CONTENT_RANGE_BYTES), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    const binary = this.transport as Partial<BinaryQueryTransport>;
    if (typeof binary.queryWithBody !== "function") throw new TypeError("canonical file range transport does not support binary query results");
    const response = await binary.queryWithBody<JsonValue>(FILE_VIEWER_OPERATIONS.contentRange, payload, options);
    const range = validateBinaryContentRange(response.result, response.body);
    if (range.relativePath !== payload.path || range.offset !== payload.offset || range.requestedLength !== payload.length) throw new TypeError("file content range response identity is invalid");
    return range;
  }

  async readContentText(path: string, offset: number, length: number, projectId?: string, options: QueryOptions = {}): Promise<FileViewerContentRange & { readonly text: string; readonly invalidEncoding: boolean }> {
    const payload = { path: boundedPath(path, "file path"), offset: boundedUInt(offset, "offset"), length: boundedPositiveUInt(length, "length", 1024 * 1024), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    const value = await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.contentText, payload, options);
    if (!isRecord(value) || typeof value.text !== "string" || typeof value.invalidEncoding !== "boolean") throw new TypeError("file content text response is invalid");
    return Object.freeze({ ...validateContentRange(value), text: value.text, invalidEncoding: value.invalidEncoding });
  }

  async readContentHex(path: string, offset: number, length: number, bytesPerRow = 16, projectId?: string, options: QueryOptions = {}): Promise<FileViewerContentRange & { readonly bytesPerRow: number; readonly rows: readonly FileViewerHexRow[] }> {
    const payload = { path: boundedPath(path, "file path"), offset: boundedUInt(offset, "offset"), length: boundedPositiveUInt(length, "length", 1024 * 1024), bytesPerRow: boundedPositiveUInt(bytesPerRow, "bytes per row", 64), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    const value = await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.contentHex, payload, options);
    if (!isRecord(value) || !safeUInt(value.bytesPerRow) || !Array.isArray(value.rows) || value.rows.length > 16_384) throw new TypeError("file content HEX response is invalid");
    const rows = value.rows.map((row) => {
      if (!isRecord(row) || !safeUInt(row.offset) || typeof row.hex !== "string" || row.hex.length > 256 || typeof row.ascii !== "string" || row.ascii.length > 64) throw new TypeError("file content HEX row is invalid");
      return Object.freeze({ offset: row.offset, hex: row.hex, ascii: row.ascii });
    });
    return Object.freeze({ ...validateContentRange(value), bytesPerRow: value.bytesPerRow, rows: Object.freeze(rows) });
  }

  async readContentPreview(path: string, projectId?: string, options: QueryOptions = {}): Promise<FileViewerContentRange & { readonly decodedImagePixelLimit: number }> {
    const payload = { path: boundedPath(path, "file path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    const value = await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.contentPreview, payload, options);
    if (!isRecord(value) || !safeUInt(value.decodedImagePixelLimit)) throw new TypeError("file content preview response is invalid");
    return Object.freeze({ ...validateContentRange(value, 16 * 1024 * 1024), decodedImagePixelLimit: value.decodedImagePixelLimit });
  }

  /**
   * Open a sequential, resumable bounded transfer over the server content
   * contract. Range mode keeps large text and binary reads incremental; preview
   * mode uses the server's capped asset read and exposes it as chunks without
  * making the caller handle base64 or transport details.
  */
  async openContentStream(path: string, projectId?: string, options: FileViewerContentStreamOptions = {}): Promise<FileViewerContentStream> {
    const capabilities = await this.getContentCapabilities(path, projectId, options.signal === undefined ? {} : { signal: options.signal });
    const startOffset = boundedUInt(options.startOffset ?? 0, "stream start offset");
    const chunkBytes = boundedPositiveUInt(options.chunkBytes ?? DEFAULT_CONTENT_STREAM_CHUNK_BYTES, "stream chunk size", MAX_CONTENT_STREAM_CHUNK_BYTES);
    const maxBytes = boundedPositiveUInt(options.maxBytes ?? DEFAULT_CONTENT_STREAM_MAX_BYTES, "stream byte limit", MAX_CONTENT_STREAM_BYTES);
    const mode = options.mode ?? (capabilities.canPreview ? "preview" : "range");
    if (mode !== "range" && mode !== "preview") throw new TypeError("file content stream mode is invalid");
    if (mode === "preview" && !capabilities.canPreview) throw new RangeError("file content does not support preview streaming");
    if (startOffset > capabilities.size) throw new RangeError("stream start offset exceeds file size");

    const state: MutableFileViewerContentStreamState = {
      nextOffset: startOffset,
      bytesTransferred: 0,
      complete: startOffset === capabilities.size,
      truncated: false,
    };
    const chunks = this.iterateContentStream(path, projectId, capabilities, {
      chunkBytes,
      maxBytes,
      mode,
      signal: options.signal,
      startOffset,
      state,
    });
    return { capabilities, state, chunks };
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

  async getFolderMarkdownTasks(path: string, projectId?: string, taskOptions: FolderMarkdownTaskOptions = {}, options: QueryOptions = {}): Promise<FolderMarkdownTaskAggregation> {
    const payload = { path: boundedPath(path, "folder path"), options: validateFolderMarkdownTaskOptions(taskOptions), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
    const binary = this.transport as Partial<BinaryQueryTransport>;
    if (typeof binary.queryWithBody === "function") {
      const response = await binary.queryWithBody<JsonValue>(FILE_VIEWER_OPERATIONS.folderTasks, payload, options);
      return validateFolderMarkdownTasks(parseJsonBody(response.body, "folder markdown task aggregation"));
    }
    return validateFolderMarkdownTasks(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.folderTasks, payload, options));
  }

  getGitDiff(path: string, options: QueryOptions = {}): Promise<JsonValue> {
    if (typeof path !== "string" || path.length === 0 || path.includes("\0")) throw new TypeError("file path is invalid");
    return this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.gitDiff, { path }, options);
  }

  async getTextMetadata(path: string, projectRoot: string, options: QueryOptions = {}): Promise<FileTextMetadata> {
    const payload = { path: boundedPath(path, "file path"), projectRoot: boundedPath(projectRoot, "project root") };
    return validateTextMetadata(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.textMetadata, payload, options));
  }

  /**
   * Server-scoped replacement for the legacy project-root metadata query.
   * It remains separate until the matching line-window operation is server
   * backed, so the existing Desktop viewer does not mix two authorities.
   */
  async getServerTextMetadata(path: string, projectId?: string, options: QueryOptions = {}): Promise<FileTextMetadata> {
    const payload = { path: boundedPath(path, "file path"), ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }) };
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

  /** Reads an exact server-indexed line window without byte-offset estimation. */
  async readServerTextLines(path: string, startLine: number, lineCount: number, projectId?: string, options: QueryOptions = {}): Promise<FileTextWindow> {
    const payload = {
      path: boundedPath(path, "file path"),
      startLine: boundedUInt(startLine, "start line"),
      lineCount: boundedPositiveUInt(lineCount, "line count", 512),
      ...(projectId === undefined ? {} : { projectId: boundedPath(projectId, "project id") }),
    };
    return validateTextWindow(await this.transport.query<JsonValue>(FILE_VIEWER_OPERATIONS.textLines, payload, options), true);
  }

  async saveSparseFile(request: FileSparseSaveRequest, options: CommandOptions = {}): Promise<void> {
    const payload = validateSparseSaveRequest(request);
    await this.transport.command<JsonValue>(FILE_VIEWER_OPERATIONS.saveSparse, payload, options);
  }

  private async *iterateContentStream(
    path: string,
    projectId: string | undefined,
    capabilities: FileViewerContentCapabilities,
    options: MutableFileViewerContentStreamOptions,
  ): AsyncGenerator<FileViewerContentStreamChunk> {
    const endOffset = Math.min(capabilities.size, options.startOffset + options.maxBytes);
    if (options.startOffset >= endOffset) {
      options.state.complete = options.startOffset === capabilities.size;
      options.state.truncated = options.startOffset < capabilities.size;
      return;
    }

    if (options.mode === "preview") {
      const preview = await this.readContentPreview(path, projectId, { signal: options.signal });
      assertContentIdentity(preview, capabilities, 0);
      if (preview.decodedImagePixelLimit !== capabilities.maxDecodedImagePixels) throw new TypeError("file content stream resource cap changed");
      let offset = options.startOffset;
      while (offset < endOffset) {
        throwIfAborted(options.signal);
        const requestedLength = Math.min(options.chunkBytes, endOffset - offset);
        const sourceOffset = offset - preview.offset;
        const bytes = preview.bytes.slice(sourceOffset, sourceOffset + requestedLength);
        if (bytes.byteLength === 0) {
          options.state.truncated = offset < capabilities.size;
          break;
        }
        const nextOffset = offset + bytes.byteLength;
        const streamTruncated = nextOffset < capabilities.size && (nextOffset >= endOffset || bytes.byteLength < requestedLength || preview.truncated);
        options.state.nextOffset = nextOffset;
        options.state.bytesTransferred += bytes.byteLength;
        options.state.truncated = streamTruncated;
        options.state.complete = nextOffset >= capabilities.size;
        yield Object.freeze({
          ...preview,
          offset,
          requestedLength,
          bytes,
          truncated: bytes.byteLength < requestedLength,
          decodedImagePixelLimit: preview.decodedImagePixelLimit,
          streamTruncated,
        });
        offset = nextOffset;
        if (bytes.byteLength < requestedLength || preview.truncated) break;
      }
      return;
    }

    let offset = options.startOffset;
    while (offset < endOffset) {
      throwIfAborted(options.signal);
      const requestedLength = Math.min(options.chunkBytes, endOffset - offset);
      const range = await this.readContentRange(path, offset, requestedLength, projectId, { signal: options.signal });
      assertContentIdentity(range, capabilities, offset);
      if (range.bytes.byteLength === 0) {
        options.state.truncated = offset < capabilities.size;
        break;
      }
      const nextOffset = offset + range.bytes.byteLength;
      const streamTruncated = nextOffset < capabilities.size && (nextOffset >= endOffset || range.bytes.byteLength < requestedLength || range.truncated);
      options.state.nextOffset = nextOffset;
      options.state.bytesTransferred += range.bytes.byteLength;
      options.state.truncated = streamTruncated;
      options.state.complete = nextOffset >= capabilities.size;
      yield Object.freeze({
        ...range,
        decodedImagePixelLimit: capabilities.maxDecodedImagePixels,
        streamTruncated,
      });
      offset = nextOffset;
      if (range.bytes.byteLength < requestedLength || range.truncated) break;
    }
  }
}

type MutableFileViewerContentStreamState = {
  nextOffset: number;
  bytesTransferred: number;
  complete: boolean;
  truncated: boolean;
};

type MutableFileViewerContentStreamOptions = FileViewerContentStreamOptions & {
  readonly chunkBytes: number;
  readonly maxBytes: number;
  readonly mode: FileViewerContentStreamMode;
  readonly startOffset: number;
  readonly state: MutableFileViewerContentStreamState;
};

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

function validateContentCapabilities(value: JsonValue): FileViewerContentCapabilities {
  if (!isRecord(value) || typeof value.relativePath !== "string" || value.relativePath.length > 4096 || !safeUInt(value.size) || !isContentKind(value.kind) || typeof value.contentType !== "string" || value.contentType.length > 256 || typeof value.isLarge !== "boolean" || typeof value.canPreview !== "boolean" || typeof value.canText !== "boolean" || typeof value.canHex !== "boolean" || !safeUInt(value.maxDecodedImagePixels)) throw new TypeError("file content capabilities are invalid");
  return Object.freeze({ relativePath: value.relativePath, size: value.size, kind: value.kind, contentType: value.contentType, isLarge: value.isLarge, canPreview: value.canPreview, canText: value.canText, canHex: value.canHex, maxDecodedImagePixels: value.maxDecodedImagePixels });
}

function validateContentRange(value: JsonValue, maxBytes = 4 * 1024 * 1024): FileViewerContentRange {
  if (!isRecord(value) || typeof value.relativePath !== "string" || value.relativePath.length > 4096 || !isContentKind(value.kind) || typeof value.contentType !== "string" || value.contentType.length > 256 || !safeUInt(value.offset) || !safeUInt(value.requestedLength) || typeof value.bytes !== "string" || !safeUInt(value.totalSize) || typeof value.truncated !== "boolean") throw new TypeError("file content range is invalid");
  const bytes = decodeBase64(value.bytes, maxBytes);
  if (bytes.byteLength > value.requestedLength || value.offset > value.totalSize) throw new TypeError("file content range exceeds bounds");
  return Object.freeze({ relativePath: value.relativePath, kind: value.kind, contentType: value.contentType, offset: value.offset, requestedLength: value.requestedLength, bytes, totalSize: value.totalSize, truncated: value.truncated });
}

function validateBinaryContentRange(value: JsonValue, body: Uint8Array): FileViewerContentRange {
  if (!isRecord(value) || typeof value.relativePath !== "string" || value.relativePath.length > 4096 || !isContentKind(value.kind) || typeof value.contentType !== "string" || value.contentType.length > 256 || !safeUInt(value.offset) || !safeUInt(value.requestedLength) || !safeUInt(value.bodyLength) || !safeUInt(value.totalSize) || typeof value.truncated !== "boolean") throw new TypeError("file content range metadata is invalid");
  if (!(body instanceof Uint8Array) || body.byteLength !== value.bodyLength || body.byteLength > value.requestedLength || body.byteLength > MAX_FILE_CONTENT_RANGE_BYTES || value.offset > value.totalSize || value.offset + body.byteLength > value.totalSize) throw new TypeError("file content range body is invalid");
  return Object.freeze({ relativePath: value.relativePath, kind: value.kind, contentType: value.contentType, offset: value.offset, requestedLength: value.requestedLength, bytes: body, totalSize: value.totalSize, truncated: value.truncated });
}

function assertContentIdentity(value: FileViewerContentRange, capabilities: FileViewerContentCapabilities, expectedOffset: number): void {
  if (value.relativePath !== capabilities.relativePath || value.kind !== capabilities.kind || value.contentType !== capabilities.contentType || value.totalSize !== capabilities.size || value.offset !== expectedOffset) {
    throw new TypeError("file content stream response is not contiguous");
  }
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

function validateFolderMarkdownTasks(value: JsonValue): FolderMarkdownTaskAggregation {
  if (!isRecord(value) || typeof value.root !== "string" || value.root.length > 4096 || !Array.isArray(value.files) || !Array.isArray(value.tasks) || !isRecord(value.stats) || !safeUInt(value.scannedEntries) || !safeUInt(value.scannedFiles) || !safeUInt(value.readBytes) || typeof value.truncated !== "boolean") throw new TypeError("folder markdown task aggregation is invalid");
  if (value.files.length > 10_000 || value.tasks.length > 100_000) throw new TypeError("folder markdown task aggregation exceeds bounds");
  const files = value.files.map(validateFolderMarkdownTaskFile);
  const tasks = value.tasks.map(validateFolderMarkdownTaskItem);
  return Object.freeze({
    root: value.root,
    files: Object.freeze(files),
    tasks: Object.freeze(tasks),
    stats: validateFolderMarkdownTaskStats(value.stats),
    scannedEntries: value.scannedEntries,
    scannedFiles: value.scannedFiles,
    readBytes: value.readBytes,
    truncated: value.truncated,
  });
}

function parseJsonBody(body: Uint8Array, description: string): JsonValue {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as JsonValue;
  } catch (error) {
    throw new TypeError(`${description} body is invalid JSON`, { cause: error });
  }
}

function validateFolderMarkdownTaskFile(value: JsonValue): FolderMarkdownTaskFile {
  if (!isRecord(value) || typeof value.relativePath !== "string" || value.relativePath.length > 4096 || !safeUInt(value.size) || !Array.isArray(value.sections) || !Array.isArray(value.tasks) || !isRecord(value.stats) || typeof value.truncated !== "boolean" || typeof value.invalidEncoding !== "boolean") throw new TypeError("folder markdown task file is invalid");
  if (value.sections.length > 10_000 || value.tasks.length > 100_000) throw new TypeError("folder markdown task file exceeds bounds");
  return Object.freeze({
    relativePath: value.relativePath,
    size: value.size,
    ...(finiteNumberOrUndefined(value.mtimeMs) === undefined ? {} : { mtimeMs: finiteNumberOrUndefined(value.mtimeMs) }),
    sections: Object.freeze(value.sections.map(validateFolderMarkdownTaskSection)),
    tasks: Object.freeze(value.tasks.map(validateFolderMarkdownTaskItem)),
    stats: validateFolderMarkdownTaskStats(value.stats),
    truncated: value.truncated,
    invalidEncoding: value.invalidEncoding,
  });
}

function validateFolderMarkdownTaskSection(value: JsonValue): FolderMarkdownTaskSection {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length > 4096 || (value.title !== null && typeof value.title !== "string") || !safeUInt(value.level) || !Array.isArray(value.tasks) || !Array.isArray(value.children)) throw new TypeError("folder markdown task section is invalid");
  if (value.tasks.length > 100_000 || value.children.length > 10_000) throw new TypeError("folder markdown task section exceeds bounds");
  return Object.freeze({
    id: value.id,
    title: value.title,
    level: value.level,
    tasks: Object.freeze(value.tasks.map(validateFolderMarkdownTaskItem)),
    children: Object.freeze(value.children.map(validateFolderMarkdownTaskSection)),
  });
}

function validateFolderMarkdownTaskItem(value: JsonValue): FolderMarkdownTaskItem {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length > 4096 || typeof value.relativePath !== "string" || value.relativePath.length > 4096 || !safeUInt(value.lineNumber) || typeof value.label !== "string" || value.label.length > 4096 || typeof value.checked !== "boolean" || !safeUInt(value.depth) || !Array.isArray(value.sectionPath) || value.sectionPath.length > 64) throw new TypeError("folder markdown task item is invalid");
  const sectionPath = value.sectionPath.map((section) => {
    if (typeof section !== "string" || section.length > 1024) throw new TypeError("folder markdown task section path is invalid");
    return section;
  });
  return Object.freeze({ id: value.id, relativePath: value.relativePath, lineNumber: value.lineNumber, label: value.label, checked: value.checked, depth: value.depth, sectionPath: Object.freeze(sectionPath) });
}

function validateFolderMarkdownTaskStats(value: Record<string, JsonValue>): FolderMarkdownTaskStats {
  const total = value.total;
  const completed = value.completed;
  const remaining = value.remaining;
  if (!safeUInt(total) || !safeUInt(completed) || !safeUInt(remaining) || completed + remaining !== total) throw new TypeError("folder markdown task stats are invalid");
  return Object.freeze({ total, completed, remaining });
}

function validateFolderMarkdownTaskOptions(options: FolderMarkdownTaskOptions): JsonValue {
  if (typeof options !== "object" || options === null || Array.isArray(options)) throw new TypeError("folder markdown task options are invalid");
  const result: Record<string, JsonValue> = {};
  for (const key of ["maxDepth", "maxEntries", "maxFiles", "maxBytes", "maxTasks", "maxFileBytes", "maxTaskLabelLength"] as const) {
    const value = options[key];
    if (value !== undefined) {
      if (typeof value !== "number") throw new TypeError(`${key} is invalid`);
      result[key] = boundedPositiveUInt(value, key, 100_000_000);
    }
  }
  if (options.ignoredDirectories !== undefined) {
    if (!Array.isArray(options.ignoredDirectories) || options.ignoredDirectories.length > 1024) throw new TypeError("folder markdown ignored directories are invalid");
    result.ignoredDirectories = options.ignoredDirectories.map((entry) => {
      if (typeof entry !== "string") throw new TypeError("folder markdown ignored directory is invalid");
      return boundedIgnorePattern(entry);
    });
  }
  return Object.freeze(result);
}

function boundedIgnorePattern(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0") || value.includes("/") || value.includes("\\")) throw new TypeError("folder markdown ignored directory is invalid");
  return value;
}

function decodeBase64(value: string, maxBytes = 4 * 1024 * 1024): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new TypeError("file bytes are invalid");
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (bytes.byteLength > maxBytes) throw new TypeError("file bytes exceed the bounded response limit");
  return bytes;
}
function bytesToBase64(value: Uint8Array): string { let binary = ""; for (const byte of value) binary += String.fromCharCode(byte); return btoa(binary); }
function boundedText(value: string, name: string): string { if (typeof value !== "string" || value.length > 100 * 1024 * 1024) throw new RangeError(`${name} is invalid`); return value; }
function isPreviewKind(value: unknown): value is FileViewerPreviewKind { return value === "markdown" || value === "image" || value === "pdf" || value === "text" || value === "hex" || value === "unsupported"; }
function isPreferredMode(value: unknown): value is "preview" | "text" | "hex" { return value === "preview" || value === "text" || value === "hex"; }
function isContentKind(value: unknown): value is FileViewerContentKind { return value === "text" || value === "markdown" || value === "image" || value === "pdf" || value === "binary"; }
function isWatchState(value: unknown): value is FileViewerSessionMetadata["watchState"] { return value === "watching" || value === "conflict" || value === "unavailable" || value === "closed"; }
function safeUIntOrUndefined(value: unknown): number | undefined { return value === undefined ? undefined : safeUInt(value) ? value : undefined; }
function finiteNumberOrUndefined(value: unknown): number | undefined { return value === undefined ? undefined : finiteNumber(value) ? value : undefined; }

function validateTextWindow(value: JsonValue, requireIndexState = false): FileTextWindow {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length > 4096 || !safeUInt(value.lineCount) || !safeUInt(value.startLine) || !Array.isArray(value.lines) || value.lines.length > 512) throw new TypeError("file text window is invalid");
  if (requireIndexState && (!safeUInt(value.indexedByteLength) || typeof value.indexComplete !== "boolean" || typeof value.windowComplete !== "boolean")) throw new TypeError("file text window index state is invalid");
  const indexedByteLength = safeUInt(value.indexedByteLength) ? value.indexedByteLength : undefined;
  const indexComplete = typeof value.indexComplete === "boolean" ? value.indexComplete : undefined;
  const windowComplete = typeof value.windowComplete === "boolean" ? value.windowComplete : undefined;
  const lines = value.lines.map((line) => {
    if (!isRecord(line) || !safeUInt(line.end) || !safeUInt(line.lineNumber) || !safeUInt(line.start) || line.end < line.start || typeof line.text !== "string" || line.text.length > 1024 * 1024 || (line.eol !== "" && line.eol !== "\n" && line.eol !== "\r\n")) throw new TypeError("file text line is invalid");
    return Object.freeze({ end: line.end, eol: line.eol, lineNumber: line.lineNumber, start: line.start, text: line.text });
  });
  return Object.freeze({
    lineCount: value.lineCount,
    lines: Object.freeze(lines),
    path: value.path,
    startLine: value.startLine,
    ...(indexedByteLength === undefined ? {} : { indexedByteLength }),
    ...(indexComplete === undefined ? {} : { indexComplete }),
    ...(windowComplete === undefined ? {} : { windowComplete }),
  });
}

function validateCatalogPage(value: JsonValue): FileCatalogPage {
  if (!isRecord(value) || typeof value.root !== "string" || !safeUInt(value.offset) || typeof value.truncated !== "boolean" || !Array.isArray(value.entries) || value.entries.length > 25_000) throw new TypeError("file catalog page is invalid");
  if (value.nextOffset !== undefined && (!safeUInt(value.nextOffset) || value.nextOffset <= value.offset)) throw new TypeError("file catalog next offset is invalid");
  const entries = value.entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.length === 0 || entry.name.length > 1_024 || typeof entry.relativePath !== "string" || entry.relativePath.length === 0 || entry.relativePath.length > 4_096 || (entry.kind !== "file" && entry.kind !== "directory" && entry.kind !== "symlink" && entry.kind !== "other") || typeof entry.isSymbolicLink !== "boolean" || typeof entry.accessible !== "boolean" || !safeUInt(entry.size) || (entry.mtimeMs !== undefined && !finiteNumber(entry.mtimeMs)) || (entry.mode !== undefined && !safeUInt(entry.mode))) throw new TypeError("file catalog entry is invalid");
    return Object.freeze({ name: entry.name, relativePath: entry.relativePath, kind: entry.kind, isSymbolicLink: entry.isSymbolicLink, accessible: entry.accessible, size: entry.size, ...(entry.mtimeMs === undefined ? {} : { mtimeMs: entry.mtimeMs }), ...(entry.mode === undefined ? {} : { mode: entry.mode }) });
  });
  return Object.freeze({ root: value.root, offset: value.offset, entries: Object.freeze(entries), truncated: value.truncated, ...(value.nextOffset === undefined ? {} : { nextOffset: value.nextOffset }) });
}

function validateCatalogSearchPage(value: JsonValue): FileCatalogSearchPage {
  if (!isRecord(value) || typeof value.root !== "string" || typeof value.query !== "string" || !safeUInt(value.scannedEntries) || typeof value.truncated !== "boolean" || !Array.isArray(value.results) || value.results.length > 1_000) throw new TypeError("file search page is invalid");
  const rawResults = value.results;
  const page = validateCatalogPage({ root: value.root, offset: 0, truncated: value.truncated, entries: rawResults });
  const results = page.entries.map((entry, index) => {
    const source = rawResults[index];
    if (!isRecord(source) || !finiteNumber(source.score)) throw new TypeError("file search result score is invalid");
    return Object.freeze({ ...entry, score: source.score });
  });
  return Object.freeze({ root: value.root, query: value.query, results: Object.freeze(results), scannedEntries: value.scannedEntries, truncated: value.truncated });
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
function throwIfAborted(signal: AbortSignal | undefined): void { if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"); }
