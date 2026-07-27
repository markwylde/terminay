import { scopeAllows } from "../auth.js";
import type { AuthScope, JsonValue } from "@terminay/protocol";
import type { CommandRequest, QueryRequest } from "../types.js";
import {
  RecordingServiceError,
  type RecordingAdapterOptions,
  type RecordingAuthorization,
  type RecordingDeleteRequest,
  type RecordingListRequest,
  type RecordingListOptions,
  type RecordingOperationHandlers,
  type RecordingReplayRequest,
  type RecordingRevealRequest,
  type RecordingRevealResult,
  type RecordingStartRequest,
  type RecordingStopRequest,
  type RecordingChunk,
  type RecordingListItem,
  type RecordingListResult,
  type RecordingStartOptions,
  type RecordingState,
} from "./types.js";
import { RecordingService } from "./service.js";

/** Stable operation names used by local and remote Terminay clients. */
export const RECORDING_OPERATIONS = Object.freeze({
  list: "recordings.list",
  replay: "recordings.replay",
  start: "recordings.start",
  stop: "recordings.stop",
  delete: "recordings.delete",
  reveal: "recordings.reveal",
} as const);

export interface RecordingAdapter {
  readonly service: RecordingService;
  list(request: RecordingListRequest): RecordingListResult;
  replay(request: RecordingReplayRequest): RecordingChunk;
  start(request: RecordingStartRequest): RecordingState;
  stop(request: RecordingStopRequest): RecordingState;
  delete(request: RecordingDeleteRequest): void;
  reveal(request: RecordingRevealRequest): Promise<RecordingRevealResult>;
  operations(): RecordingOperationHandlers;
}

/**
 * Authorization/application boundary for recording operations. It contains no
 * transport state: a disconnected client simply loses this adapter call while
 * the RecordingService continues to own the active PTY recording.
 */
export class ServerRecordingAdapter implements RecordingAdapter {
  readonly service: RecordingService;
  private readonly options: RecordingAdapterOptions;

  constructor(service: RecordingService, options: RecordingAdapterOptions) {
    if (!(service instanceof RecordingService)) throw new TypeError("recording service is required");
    if (typeof options?.serverId !== "string" || options.serverId.length === 0) throw new TypeError("recording server id is required");
    this.service = service;
    this.options = options;
  }

  list(request: RecordingListRequest): RecordingListResult {
    this.requireScope(request.authorization, "read");
    const options = normalizeListOptions(request.options);
    const projectId = options.projectId ?? request.authorization.projectId;
    this.requireProject(request.authorization, projectId ?? null);
    const result = this.service.list({ ...options, ...(projectId === undefined ? {} : { projectId }) });
    // A server may host recordings created by multiple authorities in an
    // imported library. Never allow a client to observe another server's IDs.
    const items = result.items.filter((item) => item.serverId === null || item.serverId === this.options.serverId);
    return { ...result, items, total: items.length };
  }

  replay(request: RecordingReplayRequest): RecordingChunk {
    this.requireScope(request.authorization, "read");
    const item = this.findAuthorizedItem(request.authorization, request.recordingId);
    return this.service.readRecordingChunk({ recordingId: item.recordingId, ...(request.start === undefined ? {} : { start: request.start }), ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }), ...(request.signal === undefined ? {} : { signal: request.signal }) });
  }

  start(request: RecordingStartRequest): RecordingState {
    this.requireScope(request.authorization, "write");
    this.requireServer(request.authorization);
    const projectId = request.projectId ?? request.metadata?.projectId ?? request.authorization.projectId;
    this.requireProject(request.authorization, projectId ?? null);
    const metadata: RecordingStartOptions = {
      ...(request.metadata ?? {}),
      ...(projectId === undefined ? {} : { projectId }),
      serverId: this.options.serverId,
    };
    return this.service.start(request.sessionId, metadata);
  }

  stop(request: RecordingStopRequest): RecordingState {
    this.requireScope(request.authorization, "write");
    this.requireServer(request.authorization);
    const scope = this.service.getSessionScope(request.sessionId);
    if (scope === undefined) return this.service.getState(request.sessionId);
    this.requireProject(request.authorization, request.projectId ?? scope.projectId);
    if (scope.serverId !== null && scope.serverId !== this.options.serverId) throw forbidden("recording belongs to another server");
    return this.service.finalize(request.sessionId);
  }

  delete(request: RecordingDeleteRequest): void {
    this.requireScope(request.authorization, "write");
    this.findAuthorizedItem(request.authorization, request.recordingId);
    this.service.delete(request.recordingId, { ...(request.stopFirst === undefined ? {} : { stopFirst: request.stopFirst }) });
  }

  async reveal(request: RecordingRevealRequest): Promise<RecordingRevealResult> {
    this.requireScope(request.authorization, "read");
    const item = this.findAuthorizedItem(request.authorization, request.recordingId);
    const unavailable: RecordingRevealResult = {
      recordingId: item.recordingId,
      available: false,
      guidance: "Reveal is available only from a client representing the server host; use replay or copy the recording id instead.",
    };
    if (!item.castAvailable) return { ...unavailable, guidance: "The recording cast is unavailable on the server; use its timeline metadata or retry when the configured root is mounted." };
    if (this.options.hasHostRevealCapability?.(request.authorization) !== true) return unavailable;
    if (this.options.revealOnHost === undefined) return { ...unavailable, guidance: "The server host cannot reveal recordings in this runtime; use bounded replay instead." };
    const castPath = this.service.resolveRevealPathById(item.recordingId);
    await this.options.revealOnHost(castPath, item.recordingId);
    return { recordingId: item.recordingId, available: true, guidance: "The recording was revealed on the server host." };
  }

  operations(): RecordingOperationHandlers {
    return {
      queries: {
        [RECORDING_OPERATIONS.list]: (request) => asJson(this.list(this.listRequest(request))),
        [RECORDING_OPERATIONS.replay]: (request) => asJson(this.replay(this.replayRequest(request))),
      },
      commands: {
        [RECORDING_OPERATIONS.start]: (request) => asJson(this.start(this.startRequest(request))),
        [RECORDING_OPERATIONS.stop]: (request) => asJson(this.stop(this.stopRequest(request))),
        [RECORDING_OPERATIONS.delete]: (request) => { this.delete(this.deleteRequest(request)); return null; },
        [RECORDING_OPERATIONS.reveal]: async (request) => asJson(await this.reveal(this.revealRequest(request))),
      },
      policies: {
        [RECORDING_OPERATIONS.list]: { scope: "read" },
        [RECORDING_OPERATIONS.replay]: { scope: "read" },
        [RECORDING_OPERATIONS.start]: { scope: "write" },
        [RECORDING_OPERATIONS.stop]: { scope: "write" },
        [RECORDING_OPERATIONS.delete]: { scope: "write" },
        [RECORDING_OPERATIONS.reveal]: { scope: "read" },
      },
    };
  }

  private findAuthorizedItem(authorization: RecordingAuthorization, recordingId: string) {
    let item: RecordingListItem;
    try { item = this.service.getRecording(recordingId); } catch { throw new RecordingServiceError("not_found", "Recording does not exist."); }
    if (item.serverId !== null && item.serverId !== this.options.serverId) throw new RecordingServiceError("not_found", "Recording does not exist.");
    this.requireProject(authorization, item.projectId);
    return item;
  }

  private requireServer(authorization: RecordingAuthorization): void {
    if (authorization.serverId !== this.options.serverId) throw forbidden("recording belongs to another server");
  }

  private requireScope(authorization: RecordingAuthorization, required: AuthScope): void {
    this.requireServer(authorization);
    if (!scopeAllows(authorization.scope, required)) throw forbidden(`recording operation requires ${required} scope`);
  }

  private requireProject(authorization: RecordingAuthorization, projectId: string | null): void {
    if (projectId !== null && authorization.projectId !== undefined && authorization.projectId !== projectId) throw forbidden("recording is outside the authorized project");
    if (projectId !== null && this.options.authorizeProject?.(authorization, projectId) === false) throw forbidden("recording is outside the authorized project");
  }

  private listRequest(request: QueryRequest): RecordingListRequest {
    return { authorization: this.authorization(request), options: asListOptions(request.envelope.payload) };
  }

  private replayRequest(request: QueryRequest): RecordingReplayRequest {
    const payload = objectPayload(request.envelope.payload);
    const recordingId = stringField(payload, "recordingId");
    const start = optionalUInt(payload.start, "start");
    const maxBytes = optionalUInt(payload.maxBytes, "maxBytes");
    return { authorization: this.authorization(request), recordingId, ...(start === undefined ? {} : { start }), ...(maxBytes === undefined ? {} : { maxBytes }), signal: request.context.signal };
  }

  private startRequest(request: CommandRequest): RecordingStartRequest {
    const payload = objectPayload(request.envelope.payload);
    const sessionId = stringField(payload, "sessionId");
    const projectId = optionalString(payload.projectId);
    const metadata = payload.metadata === undefined ? undefined : asStartOptions(payload.metadata);
    return { authorization: this.authorization(request), sessionId, ...(projectId === undefined ? {} : { projectId }), ...(metadata === undefined ? {} : { metadata }) };
  }

  private stopRequest(request: CommandRequest): RecordingStopRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), sessionId: stringField(payload, "sessionId"), ...(optionalString(payload.projectId) === undefined ? {} : { projectId: optionalString(payload.projectId) }) }; }
  private deleteRequest(request: CommandRequest): RecordingDeleteRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), recordingId: stringField(payload, "recordingId"), ...(typeof payload.stopFirst === "boolean" ? { stopFirst: payload.stopFirst } : {}) }; }
  private revealRequest(request: CommandRequest): RecordingRevealRequest { const payload = objectPayload(request.envelope.payload); return { authorization: this.authorization(request), recordingId: stringField(payload, "recordingId") }; }
  private authorization(request: QueryRequest | CommandRequest): RecordingAuthorization { return { serverId: this.options.serverId, clientId: request.context.clientId, scope: request.context.authScope, ...(typeof request.context.claims === "object" && request.context.claims !== null && !Array.isArray(request.context.claims) && typeof request.context.claims.projectId === "string" ? { projectId: request.context.claims.projectId } : {}) }; }
}

function forbidden(message: string): RecordingServiceError { return new RecordingServiceError("forbidden", message); }
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function objectPayload(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RecordingServiceError("invalid_request", "recording payload must be an object"); return value as Record<string, unknown>; }
function stringField(value: Record<string, unknown>, key: string): string { const candidate = value[key]; if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) throw new RecordingServiceError("invalid_request", `${key} is invalid`); return candidate; }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : typeof value === "string" && value.length <= 512 ? value : (() => { throw new RecordingServiceError("invalid_request", "string field is invalid"); })(); }
function optionalUInt(value: unknown, name: string): number | undefined { if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RecordingServiceError("invalid_request", `${name} is invalid`); return value as number; }
function normalizeListOptions(value: RecordingListOptions | undefined): RecordingListOptions { if (value === undefined) return {}; const payload = objectPayload(value); return asListOptions(payload); }
function asListOptions(value: unknown): RecordingListOptions {
  const payload = objectPayload(value);
  const state = payload.state;
  if (state !== undefined && state !== "recording" && state !== "completed" && state !== "interrupted" && state !== "failed") throw new RecordingServiceError("invalid_request", "recording state filter is invalid");
  if (payload.inputPresent !== undefined && typeof payload.inputPresent !== "boolean") throw new RecordingServiceError("invalid_request", "input-present filter is invalid");
  const search = optionalString(payload.search);
  const projectId = optionalString(payload.projectId);
  const limit = optionalUInt(payload.limit, "limit");
  const offset = optionalUInt(payload.offset, "offset");
  return { ...(search === undefined ? {} : { search }), ...(projectId === undefined ? {} : { projectId }), ...(state === undefined ? {} : { state }), ...(payload.inputPresent === undefined ? {} : { inputPresent: payload.inputPresent }), ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }) };
}
function asStartOptions(value: unknown): RecordingStartOptions { const payload = objectPayload(value); return { ...(optionalString(payload.title) === undefined ? {} : { title: optionalString(payload.title) }), ...(optionalString(payload.projectId) === undefined ? {} : { projectId: optionalString(payload.projectId) }), ...(optionalString(payload.projectName) === undefined ? {} : { projectName: optionalString(payload.projectName) }), ...(optionalString(payload.cwd) === undefined ? {} : { cwd: optionalString(payload.cwd) }), ...(optionalString(payload.shell) === undefined ? {} : { shell: optionalString(payload.shell) }), ...(typeof payload.captureInput === "boolean" ? { captureInput: payload.captureInput } : {}) }; }
