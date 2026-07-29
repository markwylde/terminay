import type { JsonValue, ProtocolError } from "./errors.js";
import { assertJsonValue } from "./json.js";

export const PROTOCOL_MIN_VERSION = 1;
export const PROTOCOL_MAX_VERSION = 1;
export const MAX_ID_LENGTH = 128;
export const MAX_OPERATION_LENGTH = 256;
export const MAX_DEADLINE_MS = 24 * 60 * 60 * 1000;

export type ProtocolId = string;
export type Capability = string;
export type AuthScope = "none" | "read" | "write" | "admin";

export interface ClientHello {
  type: "client_hello"; protocolMin: number; protocolMax: number; clientId: ProtocolId;
  clientVersion: string; capabilities: Capability[]; limits: Record<string, number>;
}
export interface ServerHello {
  type: "server_hello"; protocolVersion: number; serverId: ProtocolId; serverVersion: string;
  clientId: ProtocolId; capabilities: Capability[]; limits: Record<string, number>; authScope: AuthScope;
}
export interface CapabilitiesEnvelope { type: "capabilities"; capabilities: Capability[]; limits: Record<string, number>; }
export interface IncompatibleVersionEnvelope {
  type: "incompatible_version"; supportedMin: number; supportedMax: number; requestedMin?: number; requestedMax?: number;
  error: ProtocolError;
}
export interface QueryEnvelope { type: "query"; queryId: ProtocolId; operation: string; payload: JsonValue; deadlineMs?: number; }
export interface QueryResultEnvelope { type: "query_result"; queryId: ProtocolId; ok: boolean; result?: JsonValue; error?: ProtocolError; bodyLength?: number; }
export interface CommandEnvelope {
  type: "command"; commandId: ProtocolId; correlationId: ProtocolId; operation: string; payload: JsonValue;
  expectedRevision?: number; deadlineMs?: number;
}
export interface CommandResultEnvelope {
  type: "command_result"; commandId: ProtocolId; correlationId: ProtocolId; ok: boolean;
  result?: JsonValue; error?: ProtocolError; revision?: number;
}
export interface EventEnvelope { type: "event"; subscriptionId: ProtocolId; revision: number; cursor: string; event: string; payload: JsonValue; }
/** A bounded journal cannot replay from the requested cursor. Feature clients
 * must refresh their own authoritative snapshot before subscribing again. */
export interface EventResyncEnvelope { type: "event_resync"; subscriptionId: ProtocolId; revision: number; cursor: string; snapshot?: JsonValue; }
export interface StreamOpenEnvelope { type: "stream_open"; streamId: ProtocolId; sessionId: ProtocolId; position: number; contentType?: string; }
export interface StreamChunkEnvelope { type: "stream_chunk"; streamId: ProtocolId; position: number; final?: boolean; }
export interface StreamAckEnvelope { type: "stream_ack"; streamId: ProtocolId; position: number; }
export interface StreamCloseEnvelope { type: "stream_close"; streamId: ProtocolId; position: number; error?: ProtocolError; }
export interface BinaryStartEnvelope { type: "binary_start"; transferId: ProtocolId; size?: number; contentType: string; checksum?: string; }
export interface BinaryChunkEnvelope { type: "binary_chunk"; transferId: ProtocolId; position: number; final?: boolean; }
export interface BinaryAckEnvelope { type: "binary_ack"; transferId: ProtocolId; position: number; }
export interface BinaryCompleteEnvelope { type: "binary_complete"; transferId: ProtocolId; position: number; checksum?: string; }
export interface BinaryFailureEnvelope { type: "binary_failure"; transferId: ProtocolId; position: number; error: ProtocolError; }
export interface CancelEnvelope { type: "cancel"; correlationId: ProtocolId; reason?: string; }
export interface ErrorEnvelope { type: "error"; correlationId?: ProtocolId; error: ProtocolError; }

export type Envelope = ClientHello | ServerHello | CapabilitiesEnvelope | IncompatibleVersionEnvelope |
  QueryEnvelope | QueryResultEnvelope | CommandEnvelope | CommandResultEnvelope | EventEnvelope | EventResyncEnvelope |
  StreamOpenEnvelope | StreamChunkEnvelope | StreamAckEnvelope | StreamCloseEnvelope | BinaryStartEnvelope |
  BinaryChunkEnvelope | BinaryAckEnvelope | BinaryCompleteEnvelope | BinaryFailureEnvelope | CancelEnvelope | ErrorEnvelope;

const envelopeTypes = new Set<Envelope["type"]>([
  "client_hello", "server_hello", "capabilities", "incompatible_version", "query", "query_result", "command",
  "command_result", "event", "event_resync", "stream_open", "stream_chunk", "stream_ack", "stream_close", "binary_start",
  "binary_chunk", "binary_ack", "binary_complete", "binary_failure", "cancel", "error",
]);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const operationPattern = /^[a-z][a-z0-9._:-]{0,255}$/;
const scopeSet = new Set<AuthScope>(["none", "read", "write", "admin"]);
const errorCodes = new Set(["validation", "unauthorized", "forbidden", "not_found", "conflict", "cancelled", "deadline", "resource", "unavailable", "incompatible", "internal"]);

export function validateEnvelope(value: unknown): Envelope {
  if (!isRecord(value) || typeof value.type !== "string" || !envelopeTypes.has(value.type as Envelope["type"])) throw new TypeError("unknown envelope type");
  const type = value.type as Envelope["type"];
  const schemas: Record<Envelope["type"], string[]> = {
    client_hello: ["type", "protocolMin", "protocolMax", "clientId", "clientVersion", "capabilities", "limits"],
    server_hello: ["type", "protocolVersion", "serverId", "serverVersion", "clientId", "capabilities", "limits", "authScope"],
    capabilities: ["type", "capabilities", "limits"], incompatible_version: ["type", "supportedMin", "supportedMax", "requestedMin", "requestedMax", "error"],
    query: ["type", "queryId", "operation", "payload", "deadlineMs"], query_result: ["type", "queryId", "ok", "result", "error", "bodyLength"],
    command: ["type", "commandId", "correlationId", "operation", "payload", "expectedRevision", "deadlineMs"], command_result: ["type", "commandId", "correlationId", "ok", "result", "error", "revision"],
    event: ["type", "subscriptionId", "revision", "cursor", "event", "payload"], event_resync: ["type", "subscriptionId", "revision", "cursor", "snapshot"], stream_open: ["type", "streamId", "sessionId", "position", "contentType"],
    stream_chunk: ["type", "streamId", "position", "final"], stream_ack: ["type", "streamId", "position"], stream_close: ["type", "streamId", "position", "error"],
    binary_start: ["type", "transferId", "size", "contentType", "checksum"], binary_chunk: ["type", "transferId", "position", "final"],
    binary_ack: ["type", "transferId", "position"], binary_complete: ["type", "transferId", "position", "checksum"], binary_failure: ["type", "transferId", "position", "error"],
    cancel: ["type", "correlationId", "reason"], error: ["type", "correlationId", "error"],
  };
  const allowed = new Set(schemas[type]); for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown ${type} field ${key}`);
  checkCommon(value, type);
  return value as unknown as Envelope;
}

function checkCommon(value: Record<string, unknown>, type: Envelope["type"]): void {
  const required: Record<string, string[]> = {
    client_hello: ["protocolMin", "protocolMax", "clientId", "clientVersion", "capabilities", "limits"], server_hello: ["protocolVersion", "serverId", "serverVersion", "clientId", "capabilities", "limits", "authScope"], capabilities: ["capabilities", "limits"],
    incompatible_version: ["supportedMin", "supportedMax", "error"], query: ["queryId", "operation", "payload"], query_result: ["queryId", "ok"], command: ["commandId", "correlationId", "operation", "payload"], command_result: ["commandId", "correlationId", "ok"], event: ["subscriptionId", "revision", "cursor", "event", "payload"], event_resync: ["subscriptionId", "revision", "cursor"],
    stream_open: ["streamId", "sessionId", "position"], stream_chunk: ["streamId", "position"], stream_ack: ["streamId", "position"], stream_close: ["streamId", "position"], binary_start: ["transferId", "contentType"], binary_chunk: ["transferId", "position"], binary_ack: ["transferId", "position"], binary_complete: ["transferId", "position"], binary_failure: ["transferId", "position", "error"], cancel: ["correlationId"], error: ["error"],
  };
  for (const key of required[type]) if (!(key in value)) throw new TypeError(`${type} missing ${key}`);
  for (const key of ["clientId", "serverId", "queryId", "commandId", "correlationId", "subscriptionId", "streamId", "sessionId", "transferId"]) if (key in value) checkId(value[key], key);
  for (const key of ["revision", "expectedRevision", "position", "size", "bodyLength", "protocolMin", "protocolMax", "protocolVersion", "supportedMin", "supportedMax", "requestedMin", "requestedMax"]) if (key in value) checkUInt(value[key], key);
  if ("operation" in value && (typeof value.operation !== "string" || !operationPattern.test(value.operation))) throw new TypeError("invalid operation");
  for (const key of ["payload", "result", "snapshot"]) if (key in value) assertJsonValue(value[key]);
  if ("deadlineMs" in value && (typeof value.deadlineMs !== "number" || !Number.isSafeInteger(value.deadlineMs) || value.deadlineMs <= 0 || value.deadlineMs > MAX_DEADLINE_MS)) throw new TypeError("invalid deadline");
  for (const key of ["ok", "final"]) if (key in value && typeof value[key] !== "boolean") throw new TypeError(`invalid ${key}`);
  if ("authScope" in value && (typeof value.authScope !== "string" || !scopeSet.has(value.authScope as AuthScope))) throw new TypeError("invalid auth scope");
  if ("capabilities" in value) { if (!Array.isArray(value.capabilities) || value.capabilities.length > 256 || value.capabilities.some((x) => typeof x !== "string" || !/^[a-z][a-z0-9._:-]{0,127}$/.test(x))) throw new TypeError("invalid capabilities"); }
  if ("limits" in value) checkLimitsObject(value.limits);
  if ("contentType" in value && (typeof value.contentType !== "string" || value.contentType.length > 256)) throw new TypeError("invalid content type");
  if ("error" in value) checkError(value.error);
  if ((type === "query_result" || type === "command_result") && value.ok === true && "error" in value) throw new TypeError("successful result has error");
  if ((type === "query_result" || type === "command_result") && value.ok === false && !("error" in value)) throw new TypeError("failed result has no error");
}
function checkId(value: unknown, name: string): asserts value is string { if (typeof value !== "string" || !idPattern.test(value)) throw new TypeError(`invalid ${name}`); }
function checkUInt(value: unknown, name: string): void { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`invalid ${name}`); }
function checkLimitsObject(value: unknown): void { if (!isRecord(value)) throw new TypeError("invalid limits"); for (const [key, n] of Object.entries(value)) if (!/^max[A-Z]/.test(key) || typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) throw new TypeError(`invalid limit ${key}`); }
function checkError(value: unknown): asserts value is ProtocolError { if (!isRecord(value) || typeof value.code !== "string" || !errorCodes.has(value.code) || typeof value.message !== "string" || value.message.length === 0 || value.message.length > 4096) throw new TypeError("invalid protocol error"); if ("details" in value) assertJsonValue(value.details); if ("retryable" in value && typeof value.retryable !== "boolean") throw new TypeError("invalid retryable flag"); for (const key of ["supportedMin", "supportedMax"]) if (key in value) checkUInt(value[key], key); for (const key of Object.keys(value)) if (!["code", "message", "details", "retryable", "supportedMin", "supportedMax"].includes(key)) throw new TypeError(`unknown error field ${key}`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export interface CommandOutcome { commandId: ProtocolId; result: CommandResultEnvelope; completedAt: number; }
export type CommandResolution = { kind: "new" } | { kind: "completed"; result: CommandResultEnvelope };

export class CommandLedger {
  private readonly outcomes = new Map<ProtocolId, CommandOutcome>();
  constructor(private readonly maxEntries = 4096) {}
  begin(commandId: ProtocolId): CommandResolution { checkId(commandId, "commandId"); const prior = this.outcomes.get(commandId); return prior ? { kind: "completed", result: prior.result } : { kind: "new" }; }
  complete(result: CommandResultEnvelope): void {
    validateEnvelope(result); if (this.outcomes.size >= this.maxEntries && !this.outcomes.has(result.commandId)) this.outcomes.delete(this.outcomes.keys().next().value as ProtocolId);
    this.outcomes.set(result.commandId, { commandId: result.commandId, result, completedAt: Date.now() });
  }
  status(commandId: ProtocolId): CommandResultEnvelope | undefined { return this.outcomes.get(commandId)?.result; }
  clear(): void { this.outcomes.clear(); }
}
