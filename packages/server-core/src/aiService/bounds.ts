import { AiServiceError, type AiServiceErrorCode } from "./types.js";

export const DEFAULT_MAX_CONTEXT_BYTES = 20_000;
export const DEFAULT_MAX_CONTEXT_CHARS = 20_000;
export const DEFAULT_MAX_PROVIDER_OUTPUT_BYTES = 1_048_576;
export const DEFAULT_MAX_TITLE_CHARS = 64;
export const DEFAULT_MAX_NOTE_CHARS = 1_200;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;
export const DEFAULT_MODEL_LIST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_MODELS = 256;
export const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_AUDIO_DURATION_MS = 60_000;
export const DEFAULT_MAX_AUDIO_UPLOAD_MS = 75_000;
export const DEFAULT_MAX_TRANSCRIPT_CHARS = 8_192;
export const DEFAULT_ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "video/webm",
  "audio/mp4",
  "video/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/mpga",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
] as const;

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI8 = String.fromCharCode(0x9b);
const OSC_PATTERN = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g");
const CSI_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const CSI8_PATTERN = new RegExp(`${CSI8}[0-?]*[ -/]*[@-~]`, "g");
const ESC_PATTERN = new RegExp(`${ESC}[@-_]`, "g");
const CONTROL_PATTERN = new RegExp("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]", "g");

/** Remove ANSI/OSC controls and other non-printing controls before text is
 * sent to a provider. Newlines and tabs are retained for context/notes. */
export function stripTerminalControls(value: string): string {
  return value
    // OSC (including hyperlinks and titles) may end in BEL or ST.
    .replace(OSC_PATTERN, "")
    // CSI sequences (colours, cursor movement, erase, etc.).
    .replace(CSI_PATTERN, "")
    .replace(CSI8_PATTERN, "")
    // Remaining two-byte ESC controls.
    .replace(ESC_PATTERN, "")
    .replace(CONTROL_PATTERN, "")
    .replace(/\r/g, "");
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function trimUtf8(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be non-negative");
  if (utf8ByteLength(value) <= maxBytes) return { text: value, truncated: false };
  const bytes = new TextEncoder().encode(value).slice(-maxBytes);
  return { text: new TextDecoder().decode(bytes), truncated: true };
}

export function trimChars(value: string, maxChars: number): { readonly text: string; readonly truncated: boolean } {
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) throw new RangeError("maxChars must be non-negative");
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(-maxChars), truncated: true };
}

export function normalizeProviderName(provider: string): "codex" | "claude-code" | "disabled" {
  if (provider === "claudeCode") return "claude-code";
  if (provider === "codex" || provider === "claude-code" || provider === "disabled") return provider;
  throw new AiServiceError("invalid_request", "AI provider is invalid.");
}

export function assertPositiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

export function safeProviderError(
  error: unknown,
  fallback: string,
  code: AiServiceErrorCode = "provider_unavailable",
): AiServiceError {
  if (error instanceof AiServiceError && !isProviderErrorCode(error.code)) return error;
  // Provider stderr and exception messages are not trusted application data.
  // Keep one short line and redact common credential forms before returning it.
  const raw = error instanceof Error ? error.message : fallback;
  const sanitized = raw
    .replace(/(api[_ -]?key|token|password|secret|credential)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]")
    .replace(/\b(?:sk|key|tok|pat)-[A-Za-z0-9._-]{8,}\b/g, "[redacted]")
    .split(/\r?\n/, 1)[0]
    ?.trim();
  const safeCode = error instanceof AiServiceError ? error.code : code;
  return new AiServiceError(safeCode, sanitized || fallback, safeCode === "provider_timeout" || safeCode === "provider_cancelled");
}

function isProviderErrorCode(code: AiServiceErrorCode): boolean {
  return code.startsWith("provider_") || code.startsWith("audio_");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && (error.name === "AbortError" || /aborted|cancelled|canceled/i.test(error.message));
}

export function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function deadlineSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
  readonly timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Operation timed out", "TimeoutError"));
  }, timeoutMs);
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      if (parent !== undefined) parent.removeEventListener("abort", abort);
    },
    timedOut: () => timedOut,
  };
}

export function throwIfAborted(signal: AbortSignal, code: AiServiceErrorCode = "cancelled"): void {
  if (signal.aborted) throw new AiServiceError(code, code === "provider_cancelled" ? "AI provider request was cancelled." : "Request was cancelled.", true);
}

export function toUint8Array(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}
