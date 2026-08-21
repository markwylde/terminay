import {
  CommandLedger,
  DEFAULT_PROTOCOL_LIMITS,
  type AuthScope,
  type CommandResultEnvelope,
  type JsonValue,
  type QueryResultEnvelope,
  type ProtocolError,
  type ProtocolId,
} from "@terminay/protocol";
import { forbiddenError, scopeAllows, unknownOperationError, validateIdentity } from "./auth.js";
import { FileServiceError } from "./fileService/types.js";
import { TerminalServiceError } from "./terminalService/errors.js";
import type {
  CommandHandler,
  CommandRequest,
  OperationRegistries,
  OperationPolicy,
  QueryHandler,
  BinaryQueryHandlerResult,
  QueryRequest,
  RequestContext,
} from "./types.js";

/** The transport-neutral operation boundary shared by framed and HTTP clients. */
export interface OperationDispatcher {
  readonly query: (request: QueryRequest) => Promise<QueryDispatchResult>;
  readonly command: (request: CommandRequest) => Promise<CommandResultEnvelope>;
}

export interface QueryDispatchResult {
  readonly envelope: QueryResultEnvelope;
  readonly body: Uint8Array;
}

export interface OperationDispatcherOptions extends OperationRegistries {
  readonly defaultQueryScope?: AuthScope;
  readonly defaultCommandScope?: AuthScope;
  readonly maxBodyBytes?: number;
}

const MAX_DISPATCHERS = 256;

/**
 * Create the canonical query/command dispatcher.  Transports provide only a
 * validated envelope, bounded body, and authenticated request context; scope,
 * operation lookup, cancellation, deadlines, and command idempotency remain
 * server-owned here.
 */
export function createOperationDispatcher(options: OperationDispatcherOptions = {}): OperationDispatcher {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_PROTOCOL_LIMITS.maxBodyBytes;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0 || maxBodyBytes > DEFAULT_PROTOCOL_LIMITS.maxBodyBytes) throw new RangeError("maxBodyBytes is invalid");
  const queryLookup = makeLookup<QueryHandler>(options.queries);
  const commandLookup = makeLookup<CommandHandler>(options.commands);
  const policyLookup = makeLookup<OperationPolicy>(options.policies);
  const ledgers = new Map<ProtocolId, CommandLedger>();

  const query = async (request: QueryRequest): Promise<QueryDispatchResult> => {
    const { envelope } = request;
    validateRequestContext(request.context);
    if (request.body.byteLength > maxBodyBytes) return queryEnvelope({ type: "query_result", queryId: envelope.queryId, ok: false, error: resourceError("query body exceeds the server limit") });
    const policy = policyLookup(envelope.operation);
    const handler = queryLookup(envelope.operation) ?? policy?.query;
    if (handler === undefined) return queryEnvelope({ type: "query_result", queryId: envelope.queryId, ok: false, error: unknownOperationError(envelope.operation) });
    const required = policy?.scope ?? options.defaultQueryScope;
    if (required !== undefined && !scopeAllows(request.context.authScope, required)) return queryEnvelope({ type: "query_result", queryId: envelope.queryId, ok: false, error: forbiddenError(envelope.operation, required) });
    try {
      const value = await invoke(handler, request);
      if (isBinaryQueryResult(value)) {
        if (value.body.byteLength > maxBodyBytes) return queryEnvelope({ type: "query_result", queryId: envelope.queryId, ok: false, error: resourceError("query result body exceeds the server limit") });
        return { envelope: { type: "query_result", queryId: envelope.queryId, ok: true, result: value.result, bodyLength: value.body.byteLength }, body: value.body };
      }
      return queryEnvelope({ type: "query_result", queryId: envelope.queryId, ok: true, result: value });
    } catch (error) {
      return queryEnvelope({ type: "query_result", queryId: envelope.queryId, ok: false, error: dispatchError(error, "query failed") });
    }
  };

  const command = async (request: CommandRequest): Promise<CommandResultEnvelope> => {
    const { envelope } = request;
    validateRequestContext(request.context);
    if (request.body.byteLength > maxBodyBytes) {
      return { type: "command_result", commandId: envelope.commandId, correlationId: envelope.correlationId, ok: false, error: resourceError("command body exceeds the server limit") };
    }
    let ledger = ledgers.get(request.context.connectionId);
    if (ledger === undefined) {
      if (ledgers.size >= MAX_DISPATCHERS) ledgers.delete(ledgers.keys().next().value as ProtocolId);
      ledger = new CommandLedger();
      ledgers.set(request.context.connectionId, ledger);
    }
    const prior = ledger.begin(envelope.commandId);
    if (prior.kind === "completed") return prior.result;
    const policy = policyLookup(envelope.operation);
    const handler = commandLookup(envelope.operation) ?? policy?.command;
    let result: CommandResultEnvelope;
    if (handler === undefined) result = { type: "command_result", commandId: envelope.commandId, correlationId: envelope.correlationId, ok: false, error: unknownOperationError(envelope.operation) };
    else {
      const required = policy?.scope ?? options.defaultCommandScope;
      if (required !== undefined && !scopeAllows(request.context.authScope, required)) result = { type: "command_result", commandId: envelope.commandId, correlationId: envelope.correlationId, ok: false, error: forbiddenError(envelope.operation, required) };
      else {
        try {
          const value = await invoke(handler, request);
          const normalized = asHandlerResult(value);
          result = { type: "command_result", commandId: envelope.commandId, correlationId: envelope.correlationId, ok: true, ...(normalized.result === undefined ? {} : { result: normalized.result }), ...(normalized.revision === undefined ? {} : { revision: normalized.revision }) };
        } catch (error) {
          result = { type: "command_result", commandId: envelope.commandId, correlationId: envelope.correlationId, ok: false, error: dispatchError(error, "command failed") };
        }
      }
    }
    ledger.complete(result);
    return result;
  };

  return { query, command };
}

function queryEnvelope(envelope: QueryResultEnvelope): QueryDispatchResult { return { envelope, body: new Uint8Array() }; }
function isBinaryQueryResult(value: JsonValue | BinaryQueryHandlerResult): value is BinaryQueryHandlerResult {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "body" in value && value.body instanceof Uint8Array && "result" in value;
}

function makeLookup<T>(collection: ReadonlyMap<string, T> | Record<string, T> | undefined): (key: string) => T | undefined {
  if (collection === undefined) return () => undefined;
  if (typeof (collection as ReadonlyMap<string, T>).get === "function") return (key) => (collection as ReadonlyMap<string, T>).get(key);
  return (key) => (collection as Record<string, T>)[key];
}

function asHandlerResult(value: JsonValue | { readonly result?: JsonValue; readonly revision?: number }): { readonly result?: JsonValue; readonly revision?: number } {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && ("result" in value || "revision" in value)) return value as { result?: JsonValue; revision?: number };
  return { result: value as JsonValue };
}

async function invoke<T extends QueryHandler | CommandHandler>(handler: T, request: QueryRequest | CommandRequest): Promise<JsonValue | BinaryQueryHandlerResult | { readonly result?: JsonValue; readonly revision?: number }> {
  const parent = request.context.signal;
  if (parent.aborted) throw cancelledError();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbort = (): void => undefined;
  let rejectAbort: ((error: ProtocolError) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  // Reject the caller before notifying the handler. A handler is allowed to
  // synchronously resolve from its abort listener; letting that resolution win
  // the race would turn a cancelled request into a successful result.
  const onAbort = (): void => { rejectAbort?.(cancelledError()); controller.abort(parent.reason); };
  parent.addEventListener("abort", onAbort, { once: true });
  removeAbort = () => parent.removeEventListener("abort", onAbort);
  const remaining = request.context.deadline === undefined ? undefined : request.context.deadline - Date.now();
  if (remaining !== undefined && remaining <= 0) { removeAbort(); throw deadlineError(); }
  if (remaining !== undefined) {
    timeout = setTimeout(() => { rejectAbort?.(deadlineError()); controller.abort("deadline"); }, remaining);
  }
  const boundedRequest = { ...request, context: { ...request.context, signal: controller.signal } } as QueryRequest & CommandRequest;
  try {
    return await Promise.race([Promise.resolve(handler(boundedRequest as never)), interrupted]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeAbort();
  }
}

function validateRequestContext(context: RequestContext): void {
  validateIdentity(context.clientId, context.authScope);
  if (context.deadline !== undefined && (!Number.isSafeInteger(context.deadline) || context.deadline < 0)) throw new TypeError("invalid request deadline");
}

function resourceError(message: string): ProtocolError { return { code: "resource", message, retryable: true }; }
function cancelledError(): ProtocolError { return { code: "cancelled", message: "operation cancelled", retryable: true }; }
function deadlineError(): ProtocolError { return { code: "deadline", message: "operation deadline exceeded", retryable: true }; }

function dispatchError(error: unknown, fallback: string): ProtocolError {
  if (isProtocolError(error)) return {
    code: error.code,
    message: error.message.slice(0, 4096),
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
    ...(error.supportedMin === undefined ? {} : { supportedMin: error.supportedMin }),
    ...(error.supportedMax === undefined ? {} : { supportedMax: error.supportedMax }),
  };
  if (error instanceof TerminalServiceError) return terminalServiceError(error);
  if (error instanceof FileServiceError) return fileServiceError(error);
  if (error instanceof Error) return { code: "internal", message: fallback, retryable: false };
  return { code: "internal", message: fallback, retryable: false };
}

function terminalServiceError(error: TerminalServiceError): ProtocolError {
  switch (error.code) {
    case "session_exited":
    case "session_interrupted":
    case "session_not_found":
      return { code: "not_found", message: error.message, retryable: false };
    case "forbidden":
      return { code: "forbidden", message: error.message, retryable: false };
    case "invalid_identity":
    case "invalid_dimensions":
    case "invalid_position":
    case "invalid_bytes":
    case "invalid_cwd":
    case "invalid_environment":
      return { code: "validation", message: error.message, retryable: false };
    default:
      return { code: "internal", message: error.message, retryable: false };
  }
}

/** FileServiceError has deliberately richer domain codes than the transport.
 * Convert it here so every file adapter returns a safe, actionable protocol
 * result instead of being collapsed into the dispatcher fallback. */
function fileServiceError(error: FileServiceError): ProtocolError {
  switch (error.code) {
    case "invalid_path":
    case "invalid_range":
      if (error.message.startsWith("MDX compilation failed:"))
        return { code: "validation", message: error.message.slice(0, 4096), retryable: false };
      return { code: "validation", message: "file request is invalid", retryable: false };
    case "path_escape":
      return { code: "forbidden", message: "file path is outside the authorized project", retryable: false };
    case "path_missing":
    case "not_directory":
    case "not_file":
    case "session_closed":
      return { code: "not_found", message: "requested file resource is unavailable", retryable: true };
    case "range_too_large":
    case "draft_too_large":
      return { code: "resource", message: "file operation exceeds the server limit", retryable: false };
    case "revision_conflict":
    case "save_precondition":
    case "not_dirty":
    case "confirmation_required":
      return { code: "conflict", message: "file state changed; refresh and retry", retryable: true };
    case "read_failed":
    case "write_failed":
      return { code: "internal", message: "file operation could not be completed", retryable: false };
  }
}

function isProtocolError(value: unknown): value is ProtocolError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && ["validation", "unauthorized", "forbidden", "not_found", "conflict", "cancelled", "deadline", "resource", "unavailable", "incompatible", "internal"].includes(candidate.code) && typeof candidate.message === "string" && candidate.message.length > 0;
}
