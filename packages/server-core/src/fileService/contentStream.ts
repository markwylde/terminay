import { CanonicalProjectPathResolver } from "./pathResolver.js";
import type { CanonicalPathAdapter, MaybePromise } from "./types.js";

export interface FileContentStorage extends CanonicalPathAdapter {
  readonly readRange?: (path: string, offset: number, length: number, signal?: AbortSignal) => MaybePromise<Uint8Array>;
  readonly readFile?: (path: string, signal?: AbortSignal) => MaybePromise<Uint8Array>;
}

export interface FileContentStreamOptions {
  readonly maxRangeBytes?: number;
  readonly maxPreviewBytes?: number;
  readonly maxTextBytes?: number;
  readonly maxHexRows?: number;
  readonly maxConcurrentReads?: number;
  readonly largeFileBytes?: number;
  readonly maxDecodedImagePixels?: number;
}

export type FileContentKind = "text" | "markdown" | "image" | "pdf" | "binary";
export type FileContentErrorCode = "invalid_path" | "not_file" | "invalid_range" | "range_too_large" | "unsupported_preview" | "preview_too_large" | "concurrency_limit" | "storage_unavailable";

export class FileContentError extends Error {
  readonly code: FileContentErrorCode;
  constructor(code: FileContentErrorCode, message: string) { super(message); this.name = "FileContentError"; this.code = code; }
}

export interface FileContentCapabilities {
  readonly relativePath: string;
  readonly size: number;
  readonly kind: FileContentKind;
  readonly contentType: string;
  readonly isLarge: boolean;
  readonly canPreview: boolean;
  readonly canText: boolean;
  readonly canHex: boolean;
  readonly maxDecodedImagePixels: number;
}

export interface FileContentRange {
  readonly relativePath: string;
  readonly kind: FileContentKind;
  readonly contentType: string;
  readonly offset: number;
  readonly requestedLength: number;
  readonly bytes: Uint8Array;
  readonly totalSize: number;
  readonly truncated: boolean;
}

export interface FileContentTextRange extends FileContentRange {
  readonly text: string;
  readonly invalidEncoding: boolean;
}

export interface FileContentHexRow {
  readonly offset: number;
  readonly hex: string;
  readonly ascii: string;
}

export interface FileContentHexRange extends FileContentRange {
  readonly bytesPerRow: number;
  readonly rows: readonly FileContentHexRow[];
}

export interface FileContentPreview extends FileContentRange {
  readonly kind: "markdown" | "image" | "pdf";
  readonly decodedImagePixelLimit: number;
}

const DEFAULT_MAX_RANGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TEXT_BYTES = 1024 * 1024;
const DEFAULT_MAX_HEX_ROWS = 16_384;
const DEFAULT_MAX_CONCURRENT_READS = 4;
const DEFAULT_LARGE_FILE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_DECODED_IMAGE_PIXELS = 16_000_000;

/**
 * Bounded content transport for the server-owned file contract. The service
 * returns only project-relative identifiers, performs canonical validation at
 * every operation, and keeps image/PDF/Markdown assets separate from text and
 * HEX representations. It does not decode active content; clients render
 * preview bytes in their existing sandboxed surfaces.
 */
export class FileContentStreamService {
  readonly resolver: CanonicalProjectPathResolver;
  readonly storage: FileContentStorage;
  readonly maxRangeBytes: number;
  readonly maxPreviewBytes: number;
  readonly maxTextBytes: number;
  readonly maxHexRows: number;
  readonly maxConcurrentReads: number;
  readonly largeFileBytes: number;
  readonly maxDecodedImagePixels: number;
  private activeReads = 0;

  constructor(resolver: CanonicalProjectPathResolver, storage: FileContentStorage, options: FileContentStreamOptions = {}) {
    if (storage.readRange === undefined && storage.readFile === undefined) throw new TypeError("file content storage must provide readRange or readFile");
    this.resolver = resolver;
    this.storage = storage;
    this.maxRangeBytes = positive(options.maxRangeBytes ?? DEFAULT_MAX_RANGE_BYTES, "maxRangeBytes");
    this.maxPreviewBytes = positive(options.maxPreviewBytes ?? DEFAULT_MAX_PREVIEW_BYTES, "maxPreviewBytes");
    this.maxTextBytes = positive(options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES, "maxTextBytes");
    this.maxHexRows = positive(options.maxHexRows ?? DEFAULT_MAX_HEX_ROWS, "maxHexRows");
    this.maxConcurrentReads = positive(options.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_READS, "maxConcurrentReads");
    this.largeFileBytes = positive(options.largeFileBytes ?? DEFAULT_LARGE_FILE_BYTES, "largeFileBytes");
    this.maxDecodedImagePixels = positive(options.maxDecodedImagePixels ?? DEFAULT_MAX_DECODED_IMAGE_PIXELS, "maxDecodedImagePixels");
  }

  async capabilities(requestedPath: string, signal?: AbortSignal): Promise<FileContentCapabilities> {
    const relativePath = normalizeRelative(requestedPath);
    const canonical = await this.resolveFile(relativePath);
    const stat = await this.storage.stat(canonical);
    const size = safeSize(stat.size);
    const sample = size === 0 ? new Uint8Array() : await this.readCanonical(canonical, 0, Math.min(size, this.maxRangeBytes), signal, size);
    const detected = detectKind(relativePath, sample);
    return Object.freeze({ relativePath, size, kind: detected.kind, contentType: detected.contentType, isLarge: size > this.largeFileBytes, canPreview: detected.kind === "markdown" || detected.kind === "image" || detected.kind === "pdf", canText: detected.kind === "text" || detected.kind === "markdown", canHex: true, maxDecodedImagePixels: this.maxDecodedImagePixels });
  }

  async readRange(requestedPath: string, offset: number, length: number, signal?: AbortSignal): Promise<FileContentRange> {
    const relativePath = normalizeRelative(requestedPath);
    const canonical = await this.resolveFile(relativePath);
    const stat = await this.storage.stat(canonical);
    const totalSize = safeSize(stat.size);
    const bytes = await this.readCanonical(canonical, offset, length, signal, totalSize);
    // Classify the bytes that were actually transferred. This keeps a binary
    // file without a recognizable extension from being coerced into Text mode,
    // while still performing one bounded read at the protocol boundary.
    const detected = detectKind(relativePath, bytes);
    return Object.freeze({ relativePath, kind: detected.kind, contentType: detected.contentType, offset, requestedLength: length, bytes, totalSize, truncated: bytes.byteLength < length });
  }

  async readText(requestedPath: string, offset: number, length: number, signal?: AbortSignal): Promise<FileContentTextRange> {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.maxTextBytes) throw new FileContentError("range_too_large", "text range exceeds the configured limit");
    const range = await this.readRange(requestedPath, offset, length, signal);
    if (range.kind !== "text" && range.kind !== "markdown") throw new FileContentError("unsupported_preview", "binary content is not available in text mode");
    let text: string;
    let invalidEncoding = false;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(range.bytes); } catch { text = new TextDecoder("utf-8").decode(range.bytes); invalidEncoding = true; }
    return Object.freeze({ ...range, text, invalidEncoding });
  }

  async readHex(requestedPath: string, offset: number, length: number, bytesPerRow = 16, signal?: AbortSignal): Promise<FileContentHexRange> {
    if (!Number.isSafeInteger(bytesPerRow) || bytesPerRow < 1 || bytesPerRow > 64) throw new FileContentError("invalid_range", "bytesPerRow is invalid");
    const range = await this.readRange(requestedPath, offset, length, signal);
    const rows: FileContentHexRow[] = [];
    for (let index = 0; index < range.bytes.byteLength && rows.length < this.maxHexRows; index += bytesPerRow) {
      const row = range.bytes.subarray(index, Math.min(index + bytesPerRow, range.bytes.byteLength));
      rows.push(Object.freeze({ offset: offset + index, hex: [...row].map((byte) => byte.toString(16).padStart(2, "0")).join(" "), ascii: [...row].map((byte) => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".").join("") }));
    }
    return Object.freeze({ ...range, bytesPerRow, rows: Object.freeze(rows) });
  }

  async readPreview(requestedPath: string, signal?: AbortSignal): Promise<FileContentPreview> {
    const capabilities = await this.capabilities(requestedPath, signal);
    if (!capabilities.canPreview || (capabilities.kind !== "markdown" && capabilities.kind !== "image" && capabilities.kind !== "pdf")) throw new FileContentError("unsupported_preview", "file has no preview source");
    if (capabilities.size > this.maxPreviewBytes) throw new FileContentError("preview_too_large", "preview exceeds the configured limit");
    const relativePath = normalizeRelative(requestedPath);
    const canonical = await this.resolveFile(relativePath);
    const rangeBytes = await this.readCanonical(canonical, 0, capabilities.size, signal, capabilities.size, this.maxPreviewBytes);
    const range: FileContentRange = { relativePath, kind: capabilities.kind, contentType: capabilities.contentType, offset: 0, requestedLength: capabilities.size, bytes: rangeBytes, totalSize: capabilities.size, truncated: rangeBytes.byteLength < capabilities.size };
    return Object.freeze({ ...range, kind: capabilities.kind, decodedImagePixelLimit: this.maxDecodedImagePixels });
  }

  private async resolveFile(relativePath: string): Promise<string> {
    if (relativePath.length === 0) throw new FileContentError("invalid_path", "a file path is required");
    try { return await this.resolver.resolve(relativePath, { requireFile: true }); }
    catch (error) { if (error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === "not_file") throw new FileContentError("not_file", "path is not a file"); throw error; }
  }

  private async readCanonical(canonical: string, offset: number, length: number, signal: AbortSignal | undefined, totalSize: number, allowedLength = this.maxRangeBytes): Promise<Uint8Array> {
    validateRange(offset, length, allowedLength);
    throwIfAborted(signal);
    if (offset >= totalSize || length === 0) return new Uint8Array();
    if (this.activeReads >= this.maxConcurrentReads) throw new FileContentError("concurrency_limit", "concurrent file reads are bounded");
    this.activeReads += 1;
    try {
      const boundedLength = Math.min(length, totalSize - offset);
      let bytes: Uint8Array;
      if (this.storage.readRange !== undefined) bytes = await this.storage.readRange(canonical, offset, boundedLength, signal);
      else if (this.storage.readFile !== undefined) bytes = (await this.storage.readFile(canonical, signal)).slice(offset, offset + boundedLength);
      else throw new FileContentError("storage_unavailable", "file storage cannot read content");
      throwIfAborted(signal);
      if (!(bytes instanceof Uint8Array)) throw new FileContentError("storage_unavailable", "file storage returned invalid bytes");
      return new Uint8Array(bytes.slice(0, boundedLength));
    } finally { this.activeReads -= 1; }
  }
}

function detectKind(relativePath: string, sample: Uint8Array): { readonly kind: FileContentKind; readonly contentType: string } {
  const extension = extensionOf(relativePath);
  if (startsWithAscii(sample, "%PDF-") || extension === "pdf") return { kind: "pdf", contentType: "application/pdf" };
  if (isImage(sample, extension)) return { kind: "image", contentType: imageType(extension, sample) };
  if (extension === "md" || extension === "markdown" || extension === "mdown" || extension === "mkd") return { kind: looksUtf8(sample) ? "markdown" : "binary", contentType: "text/markdown" };
  if (looksBinary(sample) || ["bin", "dat", "exe", "dll", "so", "dylib", "wasm", "zip", "gz", "tar", "7z", "rar"].includes(extension)) return { kind: "binary", contentType: "application/octet-stream" };
  return { kind: "text", contentType: textType(extension) };
}

function isImage(sample: Uint8Array, extension: string): boolean { return startsWithBytes(sample, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || startsWithBytes(sample, [0xff, 0xd8, 0xff]) || startsWithAscii(sample, "GIF87a") || startsWithAscii(sample, "GIF89a") || ["png", "apng", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"].includes(extension); }
function imageType(extension: string, sample: Uint8Array): string { if (startsWithBytes(sample, [0x89, 0x50, 0x4e, 0x47])) return "image/png"; if (startsWithBytes(sample, [0xff, 0xd8, 0xff])) return "image/jpeg"; if (startsWithAscii(sample, "GIF")) return "image/gif"; return ({ png: "image/png", apng: "image/apng", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml" } as Record<string, string>)[extension] ?? "application/octet-stream"; }
function textType(extension: string): string { return ({ md: "text/markdown", markdown: "text/markdown", mdown: "text/markdown", mkd: "text/markdown", json: "application/json", js: "text/javascript", ts: "text/typescript", css: "text/css", html: "text/html", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml", toml: "application/toml" } as Record<string, string>)[extension] ?? "text/plain"; }
function extensionOf(value: string): string { const name = value.slice(value.lastIndexOf("/") + 1).toLocaleLowerCase(); const dot = name.lastIndexOf("."); return dot <= 0 ? "" : name.slice(dot + 1); }
function startsWithAscii(bytes: Uint8Array, value: string): boolean { if (bytes.length < value.length) return false; for (let index = 0; index < value.length; index += 1) if (bytes[index] !== value.charCodeAt(index)) return false; return true; }
function startsWithBytes(bytes: Uint8Array, expected: readonly number[]): boolean { if (bytes.length < expected.length) return false; return expected.every((byte, index) => bytes[index] === byte); }
function looksUtf8(bytes: Uint8Array): boolean { try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; } }
function looksBinary(bytes: Uint8Array): boolean { return bytes.some((byte) => byte === 0 || (byte < 7) || (byte > 14 && byte < 32 && byte !== 27)); }
function normalizeRelative(value: string): string { if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\") || value.startsWith("/")) throw new FileContentError("invalid_path", "file path is invalid"); const parts = value.split("/"); if (parts.some((part) => part.length === 0 || part === "." || part === "..")) throw new FileContentError("invalid_path", "file path is not canonical"); return parts.join("/"); }
function safeSize(value: number | undefined): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`); return value; }
function validateRange(offset: number, length: number, max: number): void { if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) throw new FileContentError("invalid_range", "file range is invalid"); if (length > max) throw new FileContentError("range_too_large", "file range exceeds the configured limit"); }
function throwIfAborted(signal: AbortSignal | undefined): void { if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"); }
