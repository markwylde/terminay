// Wire protocol for the Terminay local control surface.
//
// Transport: newline-delimited JSON (JSONL) over a local Unix domain socket.
// Each line is exactly one ControlRequest (client -> server) or one
// ControlResponse (server -> client). Requests and responses are correlated by
// `id`.
//
// Participants:
//   - Client: the `terminay mcp` subcommand (a child of an AI agent running
//     inside a Terminay terminal). It authenticates with the per-terminal
//     capability token injected into its environment.
//   - Server: the ControlServer in the Electron host compatibility boundary.
//     It validates the token, resolves the calling terminal's server-owned
//     project scope, and dispatches directly to the Local server authority.
//
// The agent never sees "projects" or other windows. Every op is implicitly
// scoped to the sibling terminals of the calling terminal.

import { homedir } from 'node:os'
import { join } from 'node:path'

export const CONTROL_PROTOCOL_VERSION = 1
export const CONTROL_MAX_FRAME_BYTES = 64 * 1024
export const CONTROL_MAX_RESPONSE_BYTES = 256 * 1024

/** Environment variables injected into every spawned shell. */
export const CONTROL_SOCKET_ENV = 'TERMINAY_CONTROL_SOCKET'
export const CONTROL_TOKEN_ENV = 'TERMINAY_CONTROL_TOKEN'

/** Default socket file name, created under the app's userData directory. */
export const CONTROL_SOCKET_FILENAME = 'control.sock'

/**
 * Compute the control socket path from OS conventions, matching Electron's
 * default `userData` directory for the "Terminay" app. The `terminay mcp`
 * process uses this when CONTROL_SOCKET_ENV is not provided (the common case,
 * since MCP clients rarely forward inherited env vars).
 */
export function getDefaultControlSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\terminay-control'
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Terminay', CONTROL_SOCKET_FILENAME)
  }
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && xdg.trim().length > 0 ? xdg : join(homedir(), '.config')
  return join(base, 'Terminay', CONTROL_SOCKET_FILENAME)
}

// --- Operations ------------------------------------------------------------

export type ControlOp =
  | 'list_terminals'
  | 'read_terminal'
  | 'get_terminal_status'
  | 'open_terminal'
  | 'write_terminal'
  | 'run_command'
  | 'close_terminal'
  | 'focus_terminal'
  | 'rename_terminal'
  | 'split_terminal'
  | 'wait_for_idle'
  | 'wait_for_command'
  | 'wait_for_attention'

export type SplitDirection = 'right' | 'left' | 'above' | 'below'

// A terminal is referenced either by its display name (tab title) or by its
// stable id. Names are resolved within the caller's scope; ids are exact.
export type TerminalRef = string

// --- Op parameter shapes ---------------------------------------------------

export type ListTerminalsParams = Record<string, never>

export interface ReadTerminalParams {
  terminal: TerminalRef
  /** Max trailing lines to return. Defaults to a sensible cap server-side. */
  lines?: number
}

export interface GetTerminalStatusParams {
  terminal: TerminalRef
}

export interface OpenTerminalParams {
  /** Optional initial tab title. */
  name?: string
  /** Optional working directory. */
  cwd?: string
  /** When set, split relative to the caller's terminal instead of a new tab. */
  split?: SplitDirection
}

export interface WriteTerminalParams {
  terminal: TerminalRef
  text: string
  /** When true, append a newline (press Enter) after the text. */
  submit?: boolean
}

export interface RunCommandParams {
  terminal: TerminalRef
  command: string
}

export interface CloseTerminalParams {
  terminal: TerminalRef
}

export interface FocusTerminalParams {
  terminal: TerminalRef
}

export interface RenameTerminalParams {
  terminal: TerminalRef
  name: string
}

export interface SplitTerminalParams {
  terminal: TerminalRef
  direction: SplitDirection
}

export interface WaitForIdleParams {
  terminal: TerminalRef
  /** Required idle duration in seconds before resolving. */
  seconds: number
  /** Optional overall timeout in seconds; resolves with timedOut=true. */
  timeout?: number
}

export interface WaitForCommandParams {
  terminal: TerminalRef
  timeout?: number
}

export interface WaitForAttentionParams {
  terminal: TerminalRef
  timeout?: number
}

export interface ControlParamsByOp {
  list_terminals: ListTerminalsParams
  read_terminal: ReadTerminalParams
  get_terminal_status: GetTerminalStatusParams
  open_terminal: OpenTerminalParams
  write_terminal: WriteTerminalParams
  run_command: RunCommandParams
  close_terminal: CloseTerminalParams
  focus_terminal: FocusTerminalParams
  rename_terminal: RenameTerminalParams
  split_terminal: SplitTerminalParams
  wait_for_idle: WaitForIdleParams
  wait_for_command: WaitForCommandParams
  wait_for_attention: WaitForAttentionParams
}

// --- Result shapes ---------------------------------------------------------

export interface TerminalInfo {
  id: string
  name: string
  /** Whether the terminal is currently doing work (semantic activity). */
  busy: boolean
  /** Whether the terminal is asking for user attention (bell/notification). */
  attention: boolean
  cwd: string | null
  /** Milliseconds since last observed activity, or null if never. */
  lastActivityAgoMs: number | null
  /** Exit code if the terminal's shell has exited, else null. */
  exitCode: number | null
  /** True for the terminal the calling agent is running in. */
  isSelf: boolean
}

export interface TerminalStatusResult {
  id: string
  name: string
  status: 'working' | 'idle' | 'exited'
  attention: boolean
  exitCode: number | null
  lastActivityAgoMs: number | null
}

export interface ListTerminalsResult {
  terminals: TerminalInfo[]
}

export interface ReadTerminalResult {
  id: string
  name: string
  output: string
}

export interface OpenTerminalResult {
  id: string
  name: string
}

export interface OkResult {
  ok: true
}

export interface SplitTerminalResult {
  id: string
  name: string
}

export interface WaitForIdleResult {
  idle: true
  timedOut: boolean
}

export interface WaitForCommandResult {
  /** Exit code of the command that completed, if known. */
  exitCode: number | null
  timedOut: boolean
}

export interface WaitForAttentionResult {
  attention: true
  timedOut: boolean
}

export interface ControlResultByOp {
  list_terminals: ListTerminalsResult
  read_terminal: ReadTerminalResult
  get_terminal_status: TerminalStatusResult
  open_terminal: OpenTerminalResult
  write_terminal: OkResult
  run_command: OkResult
  close_terminal: OkResult
  focus_terminal: OkResult
  rename_terminal: OkResult
  split_terminal: SplitTerminalResult
  wait_for_idle: WaitForIdleResult
  wait_for_command: WaitForCommandResult
  wait_for_attention: WaitForAttentionResult
}

// --- Envelopes -------------------------------------------------------------

export interface ControlRequest<Op extends ControlOp = ControlOp> {
  /** Correlates the response. Generated by the client. */
  id: string
  /** Per-terminal capability token inherited from the calling shell. */
  token: string
  version: typeof CONTROL_PROTOCOL_VERSION
  op: Op
  params: ControlParamsByOp[Op]
}

export type ControlErrorCode =
  | 'invalid_token'
  | 'not_in_terminay'
  | 'terminal_not_found'
  | 'ambiguous_terminal'
  | 'renderer_unavailable'
  | 'cancelled'
  | 'limit_exceeded'
  | 'timeout'
  | 'unsupported_op'
  | 'bad_request'
  | 'internal'

export interface ControlError {
  code: ControlErrorCode
  message: string
  /** For ambiguous_terminal: the candidate names that matched. */
  candidates?: string[]
}

export type ControlResponse<Op extends ControlOp = ControlOp> =
  | { id: string; ok: true; result: ControlResultByOp[Op] }
  | { id: string; ok: false; error: ControlError }

// --- Framing helpers -------------------------------------------------------

/** Serialize a message to a single newline-terminated JSON line. */
export function encodeControlMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

export class ControlFrameLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Control frame exceeds the ${maxBytes}-byte limit.`)
    this.name = 'ControlFrameLimitError'
  }
}

export function isControlRequest(value: unknown): value is ControlRequest {
  if (!isPlainObject(value)) {
    return false
  }
  const keys = Object.keys(value).sort()
  if (keys.join('|') !== 'id|op|params|token|version') {
    return false
  }
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 128 &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    value.token.length <= 512 &&
    value.version === CONTROL_PROTOCOL_VERSION &&
    typeof value.op === 'string' &&
    CONTROL_OPS.has(value.op as ControlOp) &&
    isPlainObject(value.params)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const CONTROL_OPS = new Set<ControlOp>([
  'list_terminals',
  'read_terminal',
  'get_terminal_status',
  'open_terminal',
  'write_terminal',
  'run_command',
  'close_terminal',
  'focus_terminal',
  'rename_terminal',
  'split_terminal',
  'wait_for_idle',
  'wait_for_command',
  'wait_for_attention',
])

/**
 * Stateful newline-delimited JSON decoder. Feed it socket chunks; it yields
 * parsed messages as complete lines arrive. Malformed lines are skipped via
 * the optional onError callback.
 */
export function createControlMessageDecoder<T = unknown>(
  onError?: (line: string, error: unknown) => void,
  options?: { maxFrameBytes?: number },
) {
  const maxFrameBytes = options?.maxFrameBytes ?? CONTROL_MAX_FRAME_BYTES
  let buffer = ''
  return (chunk: string): T[] => {
    buffer += chunk
    const messages: T[] = []
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (Buffer.byteLength(rawLine, 'utf8') > maxFrameBytes) {
        const error = new ControlFrameLimitError(maxFrameBytes)
        onError?.('', error)
        throw error
      }
      const line = rawLine.trim()
      if (line.length > 0) {
        try {
          messages.push(JSON.parse(line) as T)
        } catch (error) {
          onError?.(line, error)
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }
    if (Buffer.byteLength(buffer, 'utf8') > maxFrameBytes) {
      buffer = ''
      const error = new ControlFrameLimitError(maxFrameBytes)
      onError?.('', error)
      throw error
    }
    return messages
  }
}
