export const ERROR_CODES = [
  "validation", "unauthorized", "forbidden", "not_found", "conflict", "cancelled",
  "deadline", "resource", "unavailable", "incompatible", "internal",
] as const;
export type ProtocolErrorCode = (typeof ERROR_CODES)[number];

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
  details?: JsonValue;
  retryable?: boolean;
  supportedMin?: number;
  supportedMax?: number;
}
export type StructuredError = ProtocolError;

export class ProtocolException extends Error {
  readonly code: ProtocolErrorCode;
  readonly details?: JsonValue;
  readonly supportedMin?: number;
  readonly supportedMax?: number;
  readonly retryable: boolean;

  constructor(error: ProtocolError) {
    super(error.message);
    this.name = "ProtocolException";
    this.code = error.code;
    this.details = error.details;
    this.supportedMin = error.supportedMin;
    this.supportedMax = error.supportedMax;
    this.retryable = error.retryable === true;
  }
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function isProtocolErrorCode(value: unknown): value is ProtocolErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

export function protocolError(code: ProtocolErrorCode, message: string, extras: Omit<ProtocolError, "code" | "message"> = {}): ProtocolError {
  if (message.length === 0 || message.length > 4096) throw new RangeError("error message length");
  return { code, message, ...extras };
}
