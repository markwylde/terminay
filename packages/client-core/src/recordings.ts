import { type JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

/** Stable operation names shared by local and remote recording adapters. */
export const RECORDINGS_OPERATIONS = Object.freeze({
  list: "recordings.list",
  replay: "recordings.replay",
  start: "recordings.start",
  stop: "recordings.stop",
  delete: "recordings.delete",
  reveal: "recordings.reveal",
} as const);

export type RecordingLifecycle = "recording" | "completed" | "interrupted" | "failed";
export type RecordingStatus = "idle" | "recording" | "failed";
export type SensitiveInputPolicy = "drop" | "mask";

export interface RecordingListOptions {
  readonly search?: string;
  readonly projectId?: string;
  readonly state?: RecordingLifecycle;
  readonly inputPresent?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** Metadata intentionally excludes project roots and cast paths. */
export interface RecordingListItem {
  readonly recordingId: string;
  readonly sessionId: string;
  readonly serverId: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly color: string | null;
  readonly emoji: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly recordingState: RecordingLifecycle;
  readonly capturedInput: boolean;
  readonly inputPolicy: "none" | "record-with-sensitive-filter";
  readonly sensitiveInputPolicy: SensitiveInputPolicy;
  readonly eventCount: number;
  readonly bytesWritten: number;
  readonly castSize: number;
  readonly castAvailable: boolean;
  readonly cwdLabel: string | null;
  readonly shellName: string | null;
  readonly format: "asciicast";
  readonly formatVersion: 3;
  readonly errorMessage: string | null;
}

export interface RecordingListResult {
  readonly items: readonly RecordingListItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface RecordingChunk {
  readonly recordingId: string;
  readonly start: number;
  readonly nextOffset: number;
  readonly totalSize: number;
  readonly content: string;
  readonly eof: boolean;
  readonly incompleteTail: boolean;
}

export interface RecordingState {
  readonly sessionId: string;
  readonly recordingId: string | null;
  readonly status: RecordingStatus;
  readonly bytesWritten: number;
  readonly eventCount: number;
  readonly startedAt: string | null;
  readonly errorMessage: string | null;
}

export interface RecordingStartInput {
  readonly projectId?: string;
  readonly projectName?: string;
  readonly title?: string;
  readonly note?: string;
  readonly color?: string;
  readonly emoji?: string;
  readonly captureInput?: boolean;
  readonly sensitiveInputPolicy?: SensitiveInputPolicy;
}

export interface RecordingStopInput { readonly projectId?: string; }
export interface RecordingDeleteInput { readonly stopFirst?: boolean; }

/** Shared recording client. It owns a bounded list cache, validates server
 * DTOs, and never exposes filesystem paths to renderer code. */
export class RecordingsClient {
  private readonly listCache = new Map<string, RecordingListResult>();

  constructor(private readonly transport: QueryCommandTransport) {}

  async list(options: RecordingListOptions = {}, queryOptions: QueryOptions = {}): Promise<RecordingListResult> {
    const normalized = normalizeListOptions(options);
    const key = JSON.stringify(normalized);
    const cached = this.listCache.get(key);
    if (cached !== undefined) return cached;
    const result = await this.transport.query<JsonValue>(RECORDINGS_OPERATIONS.list, normalized as unknown as JsonValue, queryOptions);
    const validated = validateListResult(result);
    this.listCache.set(key, validated);
    return validated;
  }

  async replay(recordingId: string, options: { readonly start?: number; readonly maxBytes?: number } = {}, queryOptions: QueryOptions = {}): Promise<RecordingChunk> {
    const id = boundedId(recordingId, "recordingId");
    const start = boundedOffset(options.start, "start");
    const maxBytes = options.maxBytes === undefined ? undefined : boundedMaxBytes(options.maxBytes);
    const payload = { recordingId: id, ...(start === undefined ? {} : { start }), ...(maxBytes === undefined ? {} : { maxBytes }) };
    const result = await this.transport.query<JsonValue>(RECORDINGS_OPERATIONS.replay, payload, queryOptions);
    return validateChunk(result);
  }

  async start(sessionId: string, input: RecordingStartInput = {}, commandOptions: CommandOptions = {}): Promise<RecordingState> {
    const session = boundedText(sessionId, "sessionId");
    const metadata = {
      ...(input.projectId === undefined ? {} : { projectId: boundedId(input.projectId, "projectId") }),
      ...(input.projectName === undefined ? {} : { projectName: boundedDisplay(input.projectName, "projectName") }),
      ...(input.title === undefined ? {} : { title: boundedDisplay(input.title, "title") }),
      ...(input.note === undefined ? {} : { note: boundedDisplay(input.note, "note") }),
      ...(input.color === undefined ? {} : { color: boundedDisplay(input.color, "color") }),
      ...(input.emoji === undefined ? {} : { emoji: boundedDisplay(input.emoji, "emoji") }),
      ...(input.captureInput === undefined ? {} : { captureInput: typeof input.captureInput === "boolean" ? input.captureInput : invalid("captureInput") }),
      ...(input.sensitiveInputPolicy === undefined ? {} : { sensitiveInputPolicy: boundedPolicy(input.sensitiveInputPolicy) }),
    };
    const payload = {
      sessionId: session,
      ...(metadata.projectId === undefined ? {} : { projectId: metadata.projectId }),
      ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
    };
    this.invalidate();
    const result = await this.transport.command<JsonValue>(RECORDINGS_OPERATIONS.start, payload, commandOptions);
    return validateState(result);
  }

  async stop(sessionId: string, input: RecordingStopInput = {}, commandOptions: CommandOptions = {}): Promise<RecordingState> {
    const payload = { sessionId: boundedText(sessionId, "sessionId"), ...(input.projectId === undefined ? {} : { projectId: boundedId(input.projectId, "projectId") }) };
    this.invalidate();
    const result = await this.transport.command<JsonValue>(RECORDINGS_OPERATIONS.stop, payload, commandOptions);
    return validateState(result);
  }

  async delete(recordingId: string, input: RecordingDeleteInput = {}, commandOptions: CommandOptions = {}): Promise<void> {
    const payload = { recordingId: boundedId(recordingId, "recordingId"), ...(input.stopFirst === undefined ? {} : { stopFirst: input.stopFirst }) };
    this.invalidate();
    await this.transport.command<JsonValue>(RECORDINGS_OPERATIONS.delete, payload, commandOptions);
  }

  async reveal(recordingId: string, commandOptions: CommandOptions = {}): Promise<{ readonly recordingId: string; readonly available: boolean; readonly guidance: string }> {
    const result = await this.transport.command<JsonValue>(RECORDINGS_OPERATIONS.reveal, { recordingId: boundedId(recordingId, "recordingId") }, commandOptions);
    if (!isRecord(result) || typeof result.available !== "boolean" || typeof result.guidance !== "string" || result.guidance.length > 1024) throw new TypeError("recording reveal result is invalid");
    return Object.freeze({ recordingId: boundedId(result.recordingId, "recordingId"), available: result.available, guidance: result.guidance });
  }

  invalidate(): void { this.listCache.clear(); }
}

function normalizeListOptions(options: RecordingListOptions): RecordingListOptions {
  return {
    ...(options.search === undefined ? {} : { search: boundedDisplay(options.search, "search") }),
    ...(options.projectId === undefined ? {} : { projectId: boundedId(options.projectId, "projectId") }),
    ...(options.state === undefined ? {} : { state: boundedLifecycle(options.state) }),
    ...(options.inputPresent === undefined ? {} : { inputPresent: typeof options.inputPresent === "boolean" ? options.inputPresent : invalid("inputPresent") }),
    ...(options.limit === undefined ? {} : { limit: boundedLimit(options.limit) }),
    ...(options.offset === undefined ? {} : { offset: boundedOffset(options.offset, "offset") }),
  };
}

function validateListResult(value: JsonValue): RecordingListResult {
  if (!isRecord(value) || !Array.isArray(value.items) || !safeUInt(value.total) || !safeUInt(value.offset) || !safeUInt(value.limit) || value.limit < 1 || value.limit > 200) throw new TypeError("recording list result is invalid");
  const items = value.items.map(validateItem);
  return Object.freeze({ items: Object.freeze(items), total: value.total, offset: value.offset, limit: value.limit });
}

function validateItem(value: JsonValue): RecordingListItem {
  if (!isRecord(value)) throw new TypeError("recording list item is invalid");
  const recordingId = boundedId(value.recordingId, "recordingId");
  const sessionId = boundedText(value.sessionId, "sessionId");
  const recordingState = boundedLifecycle(value.recordingState);
  const inputPolicy = value.inputPolicy === "none" || value.inputPolicy === "record-with-sensitive-filter" ? value.inputPolicy : invalid("inputPolicy");
  const sensitiveInputPolicy = boundedPolicy(value.sensitiveInputPolicy);
  if (!isNullableString(value.serverId) || !isNullableString(value.projectId) || !isNullableString(value.projectName) || !isNullableString(value.note) || !isNullableString(value.color) || !isNullableString(value.emoji) || !isNullableString(value.endedAt) || !isNullableString(value.cwdLabel) || !isNullableString(value.shellName) || !isNullableString(value.errorMessage) || typeof value.title !== "string" || value.title.length > 512 || typeof value.startedAt !== "string" || typeof value.capturedInput !== "boolean" || typeof value.castAvailable !== "boolean" || !safeUInt(value.eventCount) || !safeUInt(value.bytesWritten) || !safeUInt(value.castSize) || !isNullableNumber(value.durationMs) || !isNullableNumber(value.exitCode) || !isNullableNumber(value.signal) || value.format !== "asciicast" || value.formatVersion !== 3) throw new TypeError("recording list item is invalid");
  // Older Desktop recording adapters included layout and theme fragments in
  // this response. They are not part of the canonical recording contract:
  // host presentation belongs to the shared UI, not an individual recording.
  // Ignore unknown legacy fields so an old server remains readable without
  // letting that compatibility shape re-enter renderer state.
  return Object.freeze({ recordingId, sessionId, serverId: value.serverId, projectId: value.projectId, projectName: value.projectName, title: value.title, note: value.note, color: value.color, emoji: value.emoji, startedAt: value.startedAt, endedAt: value.endedAt, durationMs: value.durationMs, exitCode: value.exitCode, signal: value.signal, recordingState, capturedInput: value.capturedInput, inputPolicy, sensitiveInputPolicy, eventCount: value.eventCount, bytesWritten: value.bytesWritten, castSize: value.castSize, castAvailable: value.castAvailable, cwdLabel: value.cwdLabel, shellName: value.shellName, format: "asciicast", formatVersion: 3, errorMessage: value.errorMessage });
}

function validateChunk(value: JsonValue): RecordingChunk {
  if (!isRecord(value) || typeof value.recordingId !== "string" || !safeUInt(value.start) || !safeUInt(value.nextOffset) || !safeUInt(value.totalSize) || typeof value.content !== "string" || value.content.length > 1024 * 1024 || typeof value.eof !== "boolean" || typeof value.incompleteTail !== "boolean" || value.nextOffset < value.start) throw new TypeError("recording replay result is invalid");
  return Object.freeze({ recordingId: boundedId(value.recordingId, "recordingId"), start: value.start, nextOffset: value.nextOffset, totalSize: value.totalSize, content: value.content, eof: value.eof, incompleteTail: value.incompleteTail });
}

function validateState(value: JsonValue): RecordingState {
  if (!isRecord(value) || typeof value.sessionId !== "string" || !isNullableString(value.recordingId) || (value.status !== "idle" && value.status !== "recording" && value.status !== "failed") || !safeUInt(value.bytesWritten) || !safeUInt(value.eventCount) || !isNullableString(value.startedAt) || !isNullableString(value.errorMessage)) throw new TypeError("recording state is invalid");
  return Object.freeze({ sessionId: boundedText(value.sessionId, "sessionId"), recordingId: value.recordingId, status: value.status, bytesWritten: value.bytesWritten, eventCount: value.eventCount, startedAt: value.startedAt, errorMessage: value.errorMessage });
}

function boundedId(value: unknown, name: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`); return value; }
function boundedText(value: unknown, name: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\0")) throw new TypeError(`${name} is invalid`); return value; }
function boundedDisplay(value: unknown, name: string): string { if (typeof value !== "string" || value.length > 512 || value.includes("\0")) throw new TypeError(`${name} is invalid`); return value; }
function boundedLifecycle(value: unknown): RecordingLifecycle { if (value !== "recording" && value !== "completed" && value !== "interrupted" && value !== "failed") throw new TypeError("recording state is invalid"); return value; }
function boundedPolicy(value: unknown): SensitiveInputPolicy { if (value !== "drop" && value !== "mask") throw new TypeError("sensitive input policy is invalid"); return value; }
function boundedLimit(value: unknown): number { if (!safeUInt(value) || value < 1 || value > 200) throw new RangeError("recording list limit is invalid"); return value; }
function boundedMaxBytes(value: unknown): number { if (!safeUInt(value) || value < 1 || value > 1024 * 1024) throw new RangeError("recording replay size is invalid"); return value; }
function boundedOffset(value: unknown, name: string): number | undefined { if (value === undefined) return undefined; if (!safeUInt(value)) throw new RangeError(`${name} is invalid`); return value; }
function safeUInt(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string" && value.length <= 1024 && !value.includes("\0"); }
function isNullableNumber(value: unknown): value is number | null { return value === null || typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalid(name: string): never { throw new TypeError(`${name} is invalid`); }
