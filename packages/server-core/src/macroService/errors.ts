export type MacroErrorCode =
  | "invalid_macro"
  | "macro_not_found"
  | "conflict"
  | "limit"
  | "unauthorized_target"
  | "secret_unavailable"
  | "canceled"
  | "unsupported_step"
  | "execution_failed";

export class MacroServiceError extends Error {
  readonly code: MacroErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: MacroErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "MacroServiceError";
    this.code = code;
    this.details = details;
  }
}

