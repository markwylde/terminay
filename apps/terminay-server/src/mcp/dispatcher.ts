import { ControlEndpointError } from "./controlEndpoint.js";
import type {
  ControlDispatchResult,
  ControlDispatcher,
  ControlError,
  ControlOperation,
  ControlRequestContext,
  ControlScope,
} from "./controlEndpoint.js";

export interface ServerControlHandlers {
  readonly listTerminals?: (context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly readTerminal?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly getTerminalStatus?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly openTerminal?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly writeTerminal?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly runCommand?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly closeTerminal?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly focusTerminal?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly renameTerminal?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly splitTerminal?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly waitForIdle?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly waitForCommand?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly waitForAttention?: (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
}

export interface ServerControlDispatcherOptions {
  readonly handlers: ServerControlHandlers;
  readonly operationScopes?: Partial<Record<ControlOperation, ControlScope>>;
  readonly maxParamsBytes?: number;
}

/** Typed parameter contracts for the server-owned MCP operation boundary. */
export type TerminalRef = string;
export type SplitDirection = "right" | "left" | "above" | "below";

export interface ReadTerminalParams { readonly terminal: TerminalRef; readonly lines?: number; }
export interface TerminalParams { readonly terminal: TerminalRef; }
export interface OpenTerminalParams { readonly name?: string; readonly cwd?: string; readonly split?: SplitDirection; }
export interface WriteTerminalParams { readonly terminal: TerminalRef; readonly text: string; readonly submit?: boolean; }
export interface RunCommandParams { readonly terminal: TerminalRef; readonly command: string; }
export interface RenameTerminalParams { readonly terminal: TerminalRef; readonly name: string; }
export interface SplitTerminalParams { readonly terminal: TerminalRef; readonly direction: SplitDirection; }
export interface WaitForIdleParams { readonly terminal: TerminalRef; readonly seconds: number; readonly timeout?: number; }
export interface WaitParams { readonly terminal: TerminalRef; readonly timeout?: number; }

/**
 * Concrete server operation boundary. Hosts bind these methods to
 * TerminalService/workspace/activity services; no method receives a token,
 * renderer id, or caller-supplied project. Every call receives the immutable
 * capability context and abort signal from the local endpoint.
 */
export interface TerminalControlAdapter {
  readonly listTerminals: (context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly readTerminal: (params: ReadTerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly getTerminalStatus: (params: TerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly openTerminal: (params: OpenTerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly writeTerminal: (params: WriteTerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly runCommand: (params: RunCommandParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly closeTerminal: (params: TerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly focusTerminal: (params: TerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly renameTerminal: (params: RenameTerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly splitTerminal: (params: SplitTerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly waitForIdle: (params: WaitForIdleParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly waitForCommand: (params: WaitParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly waitForAttention: (params: WaitParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
}

export interface TerminalControlAdapterOptions {
  readonly adapter: TerminalControlAdapter;
  readonly operationScopes?: Partial<Record<ControlOperation, ControlScope>>;
  readonly maxParamsBytes?: number;
  readonly maxTextBytes?: number;
  readonly maxWaitSeconds?: number;
}

const DEFAULT_SCOPES: Readonly<Partial<Record<ControlOperation, ControlScope>>> = Object.freeze({
  list_terminals: "read",
  read_terminal: "read",
  get_terminal_status: "read",
  wait_for_idle: "read",
  wait_for_command: "read",
  wait_for_attention: "read",
  open_terminal: "write",
  write_terminal: "write",
  run_command: "write",
  close_terminal: "write",
  focus_terminal: "write",
  rename_terminal: "write",
  split_terminal: "write",
});

const HANDLER_BY_OPERATION: Readonly<Record<ControlOperation, keyof ServerControlHandlers>> = Object.freeze({
  list_terminals: "listTerminals",
  read_terminal: "readTerminal",
  get_terminal_status: "getTerminalStatus",
  open_terminal: "openTerminal",
  write_terminal: "writeTerminal",
  run_command: "runCommand",
  close_terminal: "closeTerminal",
  focus_terminal: "focusTerminal",
  rename_terminal: "renameTerminal",
  split_terminal: "splitTerminal",
  wait_for_idle: "waitForIdle",
  wait_for_command: "waitForCommand",
  wait_for_attention: "waitForAttention",
});

/** Build the server-owned dispatcher consumed by the local socket. It never
 * receives a raw capability token and has no renderer/window fallback. */
export function createServerControlDispatcher(options: ServerControlDispatcherOptions): ControlDispatcher {
  const maxParamsBytes = positive(options.maxParamsBytes ?? 64 * 1024, "maxParamsBytes");
  const scopes = { ...DEFAULT_SCOPES, ...options.operationScopes };
  return async (request, context) => {
    const params = request.params;
    let encodedParams: string;
    try {
      encodedParams = JSON.stringify(params);
    } catch {
      return { ok: false, error: { code: "bad_request", message: "control parameters are not serializable" } };
    }
    if (typeof encodedParams !== "string") {
      return { ok: false, error: { code: "bad_request", message: "control parameters are not serializable" } };
    }
    if (Buffer.byteLength(encodedParams, "utf8") > maxParamsBytes) {
      return { ok: false, error: { code: "limit_exceeded", message: "control parameters exceed the server limit" } };
    }
    const required = scopes[request.op] ?? "read";
    if (!hasScope(context.scope ?? "none", required)) {
      return { ok: false, error: { code: "forbidden", message: "control capability scope is insufficient" } };
    }
    const handler = options.handlers[HANDLER_BY_OPERATION[request.op]];
    if (handler === undefined) {
      return { ok: false, error: { code: "unsupported_op", message: `control operation ${request.op} is unavailable` } };
    }
    if (request.op === "list_terminals") {
      const listHandler = options.handlers.listTerminals;
      if (listHandler === undefined) return { ok: false, error: { code: "unsupported_op", message: "control operation list_terminals is unavailable" } };
      return listHandler(context, context.signal);
    }
    const operationHandler = handler as (params: Record<string, unknown>, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
    return operationHandler(params, context, context.signal);
  };
}

const DEFAULT_MAX_TEXT_BYTES = 64 * 1024;
const DEFAULT_MAX_WAIT_SECONDS = 15 * 60;
const MAX_PUBLIC_ERROR_BYTES = 4 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SPLIT_DIRECTIONS = new Set<SplitDirection>(["right", "left", "above", "below"]);

/**
 * Adapt a typed operation implementation to the wire dispatcher. Parameter
 * validation happens before the host callback, and callback failures are
 * converted to stable public errors. This makes the adapter safe to use from
 * both a local socket and a future stdio MCP process.
 */
export function createTerminalControlAdapter(options: TerminalControlAdapterOptions): ControlDispatcher {
  if (options.adapter === undefined || options.adapter === null) throw new TypeError("a terminal control adapter is required");
  const maxTextBytes = positive(options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES, "maxTextBytes");
  const maxWaitSeconds = positive(options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS, "maxWaitSeconds");
  const invoke = <T>(signal: AbortSignal, work: () => T | Promise<T>): Promise<ControlDispatchResult> => invokeAdapter(signal, work);
  const handlers: ServerControlHandlers = {
      listTerminals: (context, signal) => invoke(signal, () => options.adapter.listTerminals(context, signal)),
      readTerminal: (params, context, signal) => invoke(signal, () => {
        const parsed = parseTerminalRead(params);
        return isControlFailure(parsed) ? parsed : options.adapter.readTerminal(parsed, context, signal);
      }),
      getTerminalStatus: (params, context, signal) => invoke(signal, () => {
        const parsed = parseTerminalOnly(params);
        return isControlFailure(parsed) ? parsed : options.adapter.getTerminalStatus(parsed, context, signal);
      }),
      openTerminal: (params, context, signal) => invoke(signal, () => {
        const parsed = parseOpenTerminal(params);
        return isControlFailure(parsed) ? parsed : options.adapter.openTerminal(parsed, context, signal);
      }),
      writeTerminal: (params, context, signal) => invoke(signal, () => {
        const parsed = parseWriteTerminal(params, maxTextBytes);
        return isControlFailure(parsed) ? parsed : options.adapter.writeTerminal(parsed, context, signal);
      }),
      runCommand: (params, context, signal) => invoke(signal, () => {
        const parsed = parseRunCommand(params, maxTextBytes);
        return isControlFailure(parsed) ? parsed : options.adapter.runCommand(parsed, context, signal);
      }),
      closeTerminal: (params, context, signal) => invoke(signal, () => {
        const parsed = parseTerminalOnly(params);
        return isControlFailure(parsed) ? parsed : options.adapter.closeTerminal(parsed, context, signal);
      }),
      focusTerminal: (params, context, signal) => invoke(signal, () => {
        const parsed = parseTerminalOnly(params);
        return isControlFailure(parsed) ? parsed : options.adapter.focusTerminal(parsed, context, signal);
      }),
      renameTerminal: (params, context, signal) => invoke(signal, () => {
        const parsed = parseRenameTerminal(params);
        return isControlFailure(parsed) ? parsed : options.adapter.renameTerminal(parsed, context, signal);
      }),
      splitTerminal: (params, context, signal) => invoke(signal, () => {
        const parsed = parseSplitTerminal(params);
        return isControlFailure(parsed) ? parsed : options.adapter.splitTerminal(parsed, context, signal);
      }),
      waitForIdle: (params, context, signal) => invoke(signal, () => {
        const parsed = parseWaitForIdle(params, maxWaitSeconds);
        return isControlFailure(parsed) ? parsed : options.adapter.waitForIdle(parsed, context, signal);
      }),
      waitForCommand: (params, context, signal) => invoke(signal, () => {
        const parsed = parseWait(params, maxWaitSeconds);
        return isControlFailure(parsed) ? parsed : options.adapter.waitForCommand(parsed, context, signal);
      }),
      waitForAttention: (params, context, signal) => invoke(signal, () => {
        const parsed = parseWait(params, maxWaitSeconds);
        return isControlFailure(parsed) ? parsed : options.adapter.waitForAttention(parsed, context, signal);
      }),
  };
  const dispatcherOptions: ServerControlDispatcherOptions = {
    handlers,
    ...(options.operationScopes === undefined ? {} : { operationScopes: options.operationScopes }),
    ...(options.maxParamsBytes === undefined ? {} : { maxParamsBytes: options.maxParamsBytes }),
  };
  return createServerControlDispatcher(dispatcherOptions);
}

async function invokeAdapter<T>(signal: AbortSignal, work: () => T | Promise<T>): Promise<ControlDispatchResult> {
  if (signal.aborted) return cancelledResult();
  try {
    const result = await work();
    return signal.aborted ? cancelledResult() : result;
  } catch (error) {
    return { ok: false, error: publicControlError(error) };
  }
}

function cancelledResult(): ControlDispatchResult {
  return { ok: false, error: { code: "cancelled", message: "The control operation was cancelled." } };
}

type ControlFailure = { readonly ok: false; readonly error: ControlError };

function isControlFailure(value: unknown): value is ControlFailure {
  return isRecord(value) && value.ok === false && isRecord(value.error);
}

function publicControlError(error: unknown): ControlError {
  const endpointError = error instanceof ControlEndpointError
    ? error
    : error instanceof Error && isControlErrorCode((error as Error & { readonly code?: unknown }).code)
      ? { code: (error as Error & { readonly code: ControlError["code"] }).code, message: error.message, candidates: (error as Error & { readonly candidates?: unknown }).candidates }
      : undefined;
  if (endpointError !== undefined) {
    const candidates = Array.isArray(endpointError.candidates)
      ? endpointError.candidates.filter((candidate): candidate is string => typeof candidate === "string" && ID_PATTERN.test(candidate)).slice(0, 32)
      : undefined;
    return { code: endpointError.code, message: endpointError.message.slice(0, MAX_PUBLIC_ERROR_BYTES), ...(candidates === undefined || candidates.length === 0 ? {} : { candidates }) };
  }
  const code = (isRecord(error) && typeof error.code === "string")
    ? error.code
    : error instanceof Error && typeof (error as Error & { readonly code?: unknown }).code === "string"
      ? (error as Error & { readonly code: string }).code
      : "internal";
  const mapped: Record<string, ControlError["code"]> = {
    forbidden: "forbidden",
    session_not_found: "terminal_not_found",
    session_exited: "terminal_not_found",
    session_interrupted: "terminal_not_found",
    input_too_large: "limit_exceeded",
    output_too_large: "limit_exceeded",
    replay_gap: "limit_exceeded",
    subscriber_limit: "limit_exceeded",
    session_limit: "limit_exceeded",
    service_shutdown: "cancelled",
    invalid_identity: "bad_request",
    invalid_dimensions: "bad_request",
    invalid_position: "bad_request",
    invalid_bytes: "bad_request",
  };
  const publicCode = mapped[code] ?? "internal";
  const messageByCode: Record<ControlError["code"], string> = {
    invalid_token: "The Terminay terminal capability is missing, invalid, stale, or revoked.",
    not_in_terminay: "The control operation requires a Terminay terminal capability.",
    terminal_not_found: "The requested terminal is unavailable.",
    ambiguous_terminal: "The terminal reference is ambiguous.",
    renderer_unavailable: "The terminal host is unavailable.",
    cancelled: "The control operation was cancelled.",
    limit_exceeded: "The control operation exceeded a configured limit.",
    timeout: "The control operation exceeded its deadline.",
    unsupported_op: "The control operation is unavailable.",
    bad_request: "The control operation parameters are invalid.",
    forbidden: "The control capability is not permitted for this operation.",
    not_found: "The requested control resource was not found.",
    internal: "The control operation failed.",
  };
  return { code: publicCode, message: messageByCode[publicCode] };
}

function isControlErrorCode(value: unknown): value is ControlError["code"] {
  return value === "invalid_token" || value === "not_in_terminay" || value === "terminal_not_found" || value === "ambiguous_terminal" || value === "renderer_unavailable" || value === "cancelled" || value === "limit_exceeded" || value === "timeout" || value === "unsupported_op" || value === "bad_request" || value === "forbidden" || value === "not_found" || value === "internal";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type ParseResult<T> = T | ControlFailure;

function parseTerminalOnly(value: Record<string, unknown>): ParseResult<TerminalParams> {
  if (!isRecord(value)) return badRequest("terminal parameters must be an object");
  const terminal = boundedString(value.terminal, "terminal", 256);
  return typeof terminal === "string" ? { terminal } : terminal;
}

function parseTerminalRead(value: Record<string, unknown>): ParseResult<ReadTerminalParams> {
  const terminal = parseTerminalOnly(value);
  if (isControlFailure(terminal)) return terminal;
  const lines = optionalPositive(value.lines, "lines", 4096);
  if (isControlFailure(lines)) return lines;
  return lines === undefined ? terminal : { ...terminal, lines };
}

function parseOpenTerminal(value: Record<string, unknown>): ParseResult<OpenTerminalParams> {
  if (!isRecord(value)) return badRequest("open terminal parameters must be an object");
  const name = optionalString(value.name, "name", 256);
  if (isControlFailure(name)) return name;
  const cwd = optionalString(value.cwd, "cwd", 4096);
  if (isControlFailure(cwd)) return cwd;
  const split = value.split;
  if (split !== undefined && (typeof split !== "string" || !SPLIT_DIRECTIONS.has(split as SplitDirection))) return badRequest("split direction is invalid");
  return { ...(name === undefined ? {} : { name }), ...(cwd === undefined ? {} : { cwd }), ...(split === undefined ? {} : { split: split as SplitDirection }) };
}

function parseWriteTerminal(value: Record<string, unknown>, maxTextBytes: number): ParseResult<WriteTerminalParams> {
  const terminal = parseTerminalOnly(value);
  if (isControlFailure(terminal)) return terminal;
  const text = boundedText(value.text, "text", maxTextBytes);
  if (isControlFailure(text)) return text;
  if (value.submit !== undefined && typeof value.submit !== "boolean") return badRequest("submit must be a boolean");
  return { ...terminal, text, ...(value.submit === undefined ? {} : { submit: value.submit }) };
}

function parseRunCommand(value: Record<string, unknown>, maxTextBytes: number): ParseResult<RunCommandParams> {
  const terminal = parseTerminalOnly(value);
  if (isControlFailure(terminal)) return terminal;
  const command = boundedText(value.command, "command", maxTextBytes);
  if (isControlFailure(command)) return command;
  return { ...terminal, command };
}

function parseRenameTerminal(value: Record<string, unknown>): ParseResult<RenameTerminalParams> {
  const terminal = parseTerminalOnly(value);
  if (isControlFailure(terminal)) return terminal;
  const name = boundedString(value.name, "name", 256);
  return typeof name === "string" ? { ...terminal, name } : name;
}

function parseSplitTerminal(value: Record<string, unknown>): ParseResult<SplitTerminalParams> {
  const terminal = parseTerminalOnly(value);
  if (isControlFailure(terminal)) return terminal;
  const direction = value.direction;
  if (typeof direction !== "string" || !SPLIT_DIRECTIONS.has(direction as SplitDirection)) return badRequest("split direction is invalid");
  return { ...terminal, direction: direction as SplitDirection };
}

function parseWaitForIdle(value: Record<string, unknown>, maxWaitSeconds: number): ParseResult<WaitForIdleParams> {
  const terminal = parseTerminalOnly(value);
  if (isControlFailure(terminal)) return terminal;
  const seconds = requiredPositive(value.seconds, "seconds", maxWaitSeconds);
  if (isControlFailure(seconds)) return seconds;
  const timeout = optionalPositive(value.timeout, "timeout", maxWaitSeconds);
  if (isControlFailure(timeout)) return timeout;
  return { ...terminal, seconds, ...(timeout === undefined ? {} : { timeout }) };
}

function parseWait(value: Record<string, unknown>, maxWaitSeconds: number): ParseResult<WaitParams> {
  const terminal = parseTerminalOnly(value);
  if (isControlFailure(terminal)) return terminal;
  const timeout = optionalPositive(value.timeout, "timeout", maxWaitSeconds);
  if (isControlFailure(timeout)) return timeout;
  return timeout === undefined ? terminal : { ...terminal, timeout };
}

function boundedString(value: unknown, name: string, maxChars: number): string | ControlFailure {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxChars || value.includes("\0")) return badRequest(`${name} is invalid`);
  return value;
}

function optionalString(value: unknown, name: string, maxChars: number): string | undefined | ControlFailure {
  if (value === undefined) return undefined;
  return boundedString(value, name, maxChars);
}

function boundedText(value: unknown, name: string, maxBytes: number): string | ControlFailure {
  if (typeof value !== "string" || value.includes("\0") || new TextEncoder().encode(value).byteLength > maxBytes) return badRequest(`${name} exceeds the configured limit`);
  return value;
}

function requiredPositive(value: unknown, name: string, max: number): number | ControlFailure {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) return badRequest(`${name} is outside the configured wait limit`);
  return value;
}

function optionalPositive(value: unknown, name: string, max: number): number | undefined | ControlFailure {
  if (value === undefined) return undefined;
  return requiredPositive(value, name, max);
}

function badRequest(message: string): ControlFailure {
  return { ok: false, error: { code: "bad_request", message } };
}

function hasScope(actual: ControlScope, required: ControlScope): boolean {
  const rank: Record<ControlScope, number> = { none: 0, read: 1, write: 2, admin: 3 };
  return rank[actual] >= rank[required];
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
