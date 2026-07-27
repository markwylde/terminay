import type { JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

export const FILE_VIEWER_OPERATIONS = Object.freeze({
  gitDiff: "file.get-git-diff",
  textMetadata: "file.text-metadata",
  textLines: "file.text-lines",
  saveSparse: "file.save-sparse",
});

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

/** Feature facade for the first server-owned file-viewer query. More file
 * operations can be added without exposing transport or host details to UI. */
export class FileViewerClient {
  constructor(private readonly transport: QueryCommandTransport) {}

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
