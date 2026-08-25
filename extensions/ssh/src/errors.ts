const SAFE_CODES = new Set([
  "invalid-input", "profile-not-found", "profile-referenced", "revision-conflict",
  "permission-denied", "unreachable", "connection-timeout", "authentication-failed",
  "host-key-approval-required", "host-key-mismatch", "trust-challenge-stale",
  "root-unavailable", "missing", "not-directory", "conflict", "too-large",
  "cancelled", "transport-lost", "outcome-unknown", "unsupported", "disabled"
]);

export class SshProviderError extends Error {
  readonly code: string;
  details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SshProviderError";
    this.code = SAFE_CODES.has(code) ? code : "unreachable";
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) }; }
}

export function normalizeError(error: unknown, fallback = "unreachable"): SshProviderError {
  if (error instanceof SshProviderError) return error;
  const value = error as { code?: unknown; level?: unknown } | undefined;
  const code = String(value?.code ?? "");
  if (code === "ENOENT" || code === "2") return new SshProviderError("missing", "Remote path does not exist");
  if (code === "ENOTDIR") return new SshProviderError("not-directory", "Remote path is not a directory");
  if (code === "EACCES" || code === "EPERM" || code === "3") return new SshProviderError("permission-denied", "Remote operation was denied");
  if (code === "EEXIST" || code === "4") return new SshProviderError("conflict", "Remote path conflicts with an existing entry");
  if (["ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(code)) return new SshProviderError("unreachable", "SSH server is unreachable");
  if (String(value?.level ?? "").includes("client-authentication")) return new SshProviderError("authentication-failed", "SSH authentication failed");
  return new SshProviderError(fallback, fallback === "outcome-unknown" ? "Remote mutation outcome is unknown" : "SSH operation failed");
}
