import { createHash } from "node:crypto";
import { FileContentError, FileContentStreamService } from "./contentStream.js";

export interface ServerTextMetadata {
  readonly indexedByteLength: number;
  readonly ino: number;
  readonly isComplete: boolean;
  readonly lineCount: number;
  readonly mtimeMs: number;
  readonly path: string;
  readonly size: number;
}

export interface ServerTextIndexOptions {
  readonly chunkBytes?: number;
  readonly maxBytesPerRequest?: number;
  readonly maxWindowBytes?: number;
}

export interface ServerTextLine {
  readonly end: number;
  readonly eol: "" | "\n" | "\r\n";
  readonly lineNumber: number;
  readonly start: number;
  readonly text: string;
}

export interface ServerTextWindow {
  readonly indexedByteLength: number;
  readonly indexComplete: boolean;
  readonly lineCount: number;
  readonly lines: readonly ServerTextLine[];
  readonly path: string;
  readonly startLine: number;
  /** True when every requested line, or every remaining line at EOF, is present. */
  readonly windowComplete: boolean;
}

type IndexEntry = {
  indexedByteLength: number;
  lineCount: number;
  lineStarts: number[];
  size: number;
  mtimeMs: number;
};

/**
 * Bounded, canonical text indexing. Each metadata request advances at most a
 * fixed byte budget; cache entries are discarded when the server-visible file
 * identity changes. This is intentionally metadata-only: line windows build
 * on the same index in the following operation.
 */
export class ServerTextIndex {
  private readonly entries = new Map<string, IndexEntry>();
  private readonly chunkBytes: number;
  private readonly maxBytesPerRequest: number;
  private readonly maxWindowBytes: number;

  constructor(private readonly content: FileContentStreamService, options: ServerTextIndexOptions = {}) {
    this.chunkBytes = positive(options.chunkBytes ?? 256 * 1024, "chunkBytes");
    this.maxBytesPerRequest = positive(options.maxBytesPerRequest ?? 1024 * 1024, "maxBytesPerRequest");
    this.maxWindowBytes = positive(options.maxWindowBytes ?? 1024 * 1024, "maxWindowBytes");
  }

  async metadata(path: string, signal?: AbortSignal): Promise<ServerTextMetadata> {
    const { canonical, entry } = await this.advance(path, signal);
    return this.metadataResult(path, canonical, entry);
  }

  /**
   * Returns lines only from exact server-owned byte boundaries. If the bounded
   * indexing budget has not reached the requested page yet, `windowComplete`
   * is false and the caller can continue the same request without estimating.
   */
  async lines(path: string, startLine: number, lineCount: number, signal?: AbortSignal): Promise<ServerTextWindow> {
    if (!Number.isSafeInteger(startLine) || startLine < 0) throw new RangeError("startLine must be a non-negative safe integer");
    if (!Number.isSafeInteger(lineCount) || lineCount < 1 || lineCount > 512) throw new RangeError("lineCount must be between 1 and 512");
    const { entry } = await this.advance(path, signal);
    const indexComplete = entry.indexedByteLength >= entry.size;
    const availableLineCount = entry.lineStarts.length;
    const requestedEnd = startLine + lineCount;
    const availableEnd = Math.min(requestedEnd, availableLineCount);
    const completeEnd = indexComplete ? availableLineCount : Math.max(0, availableLineCount - 1);
    const endLine = Math.min(availableEnd, completeEnd);
    const lines: ServerTextLine[] = [];

    if (startLine < endLine) {
      const boundary = (line: number): number => entry.lineStarts[line] ?? entry.size;
      const start = boundary(startLine);
      let boundedEndLine = endLine;
      while (boundedEndLine > startLine && boundary(boundedEndLine) - start > this.maxWindowBytes) boundedEndLine -= 1;
      if (boundedEndLine === startLine) throw new FileContentError("range_too_large", "text line exceeds the bounded window limit");
      const end = boundary(boundedEndLine);
      const range = await this.content.readRange(path, start, end - start, signal);
      let cursor = 0;
      for (let lineNumber = startLine; lineNumber < boundedEndLine; lineNumber += 1) {
        const absoluteStart = boundary(lineNumber);
        const absoluteNext = boundary(lineNumber + 1);
        const byteLength = absoluteNext - absoluteStart;
        const bytes = range.bytes.subarray(cursor, cursor + byteLength);
        cursor += byteLength;
        const hasNewline = bytes.at(-1) === 0x0a;
        const hasCarriageReturn = hasNewline && bytes.at(-2) === 0x0d;
        const contentLength = byteLength - (hasNewline ? 1 : 0) - (hasCarriageReturn ? 1 : 0);
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, contentLength));
        } catch {
          throw new FileContentError("invalid_encoding", `line ${lineNumber + 1} contains invalid UTF-8`);
        }
        lines.push(Object.freeze({
          end: absoluteStart + contentLength,
          eol: hasCarriageReturn ? "\r\n" : hasNewline ? "\n" : "",
          lineNumber,
          start: absoluteStart,
          text,
        }));
      }
    }

    const deliveredEnd = startLine + lines.length;
    return Object.freeze({
      indexedByteLength: entry.indexedByteLength,
      indexComplete,
      lineCount: entry.lineCount,
      lines: Object.freeze(lines),
      path,
      startLine,
      windowComplete: deliveredEnd >= requestedEnd || (indexComplete && deliveredEnd >= availableLineCount),
    });
  }

  private async advance(path: string, signal?: AbortSignal): Promise<{ canonical: string; entry: IndexEntry }> {
    const canonical = await this.content.resolver.resolve(path, { requireFile: true });
    const stat = await this.content.storage.stat(canonical);
    const size = safeSize(stat.size);
    const mtimeMs = typeof stat.mtimeMs === "number" && Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
    const key = `${canonical}\0${size}\0${mtimeMs}`;
    for (const previous of this.entries.keys()) if (previous.startsWith(`${canonical}\0`) && previous !== key) this.entries.delete(previous);
    let entry = this.entries.get(key) ?? { indexedByteLength: 0, lineCount: size === 0 ? 0 : 1, lineStarts: size === 0 ? [] : [0], size, mtimeMs };
    let budget = this.maxBytesPerRequest;
    while (entry.indexedByteLength < size && budget > 0) {
      const length = Math.min(this.chunkBytes, budget, size - entry.indexedByteLength);
      const range = await this.content.readRange(path, entry.indexedByteLength, length, signal);
      if (range.bytes.byteLength === 0) break;
      const lineStarts = [...entry.lineStarts];
      for (let index = 0; index < range.bytes.byteLength; index += 1) {
        if (range.bytes[index] === 10) lineStarts.push(entry.indexedByteLength + index + 1);
      }
      entry = { ...entry, indexedByteLength: entry.indexedByteLength + range.bytes.byteLength, lineCount: entry.lineCount + lineStarts.length - entry.lineStarts.length, lineStarts };
      budget -= range.bytes.byteLength;
      if (range.bytes.byteLength < length) break;
    }
    this.entries.set(key, entry);
    return { canonical, entry };
  }

  private metadataResult(path: string, canonical: string, entry: IndexEntry): ServerTextMetadata {
    return Object.freeze({ indexedByteLength: entry.indexedByteLength, ino: stableInode(canonical), isComplete: entry.indexedByteLength >= entry.size, lineCount: entry.lineCount, mtimeMs: entry.mtimeMs, path, size: entry.size });
  }
}

function safeSize(value: number | undefined): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new FileContentError("storage_unavailable", "file size is invalid"); return value; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`); return value; }
function stableInode(path: string): number { const bytes = createHash("sha256").update(path).digest(); return ((bytes[0] ?? 0) * 0x1000000) + ((bytes[1] ?? 0) << 16) + ((bytes[2] ?? 0) << 8) + (bytes[3] ?? 0); }
