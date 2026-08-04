import type { AuthScope, ProtocolError, ProtocolId } from "@terminay/protocol";

const scopeRank: Record<AuthScope, number> = { none: 0, read: 1, write: 2, admin: 3 };
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function scopeAllows(actual: AuthScope, required: AuthScope): boolean {
  return scopeRank[actual] >= scopeRank[required];
}

export function validateIdentity(clientId: ProtocolId, authScope: AuthScope): void {
  if (typeof clientId !== "string" || !idPattern.test(clientId)) throw new TypeError("invalid authenticated client id");
  if (!(authScope in scopeRank)) throw new TypeError("invalid authenticated scope");
}

export function authError(message = "authentication required"): ProtocolError {
  return { code: "unauthorized", message, retryable: false };
}

export function forbiddenError(operation: string, required: AuthScope): ProtocolError {
  return { code: "forbidden", message: `operation ${operation} requires ${required} scope`, retryable: false };
}

export function unknownOperationError(operation: string): ProtocolError {
  return { code: "not_found", message: `unknown operation ${operation}`, retryable: false };
}

