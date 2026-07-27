export type TerminalServiceErrorCode =
  | "invalid_identity"
  | "invalid_dimensions"
  | "invalid_position"
  | "invalid_bytes"
  | "session_not_found"
  | "session_exists"
  | "session_exited"
  | "session_interrupted"
  | "forbidden"
  | "input_too_large"
  | "output_too_large"
  | "replay_gap"
  | "subscriber_limit"
  | "queue_overflow"
  | "session_limit"
  | "spawn_failed"
  | "service_shutdown";

export interface TerminalServiceErrorDetails {
  readonly serverId?: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly expected?: number | string;
  readonly actual?: number | string;
  readonly max?: number;
  readonly fromPosition?: number;
  readonly replayFrom?: number;
  readonly outputPosition?: number;
  readonly reason?: string;
}

export class TerminalServiceError extends Error {
  readonly code: TerminalServiceErrorCode;
  readonly details: TerminalServiceErrorDetails | undefined;

  constructor(code: TerminalServiceErrorCode, message: string, details?: TerminalServiceErrorDetails) {
    super(message);
    this.name = "TerminalServiceError";
    this.code = code;
    this.details = details;
  }
}

