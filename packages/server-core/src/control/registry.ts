import type { AuthScope, ProtocolId } from "@terminay/protocol";

export interface ControlCapability {
  readonly token: string;
  readonly terminalSessionId: ProtocolId;
  readonly projectId: ProtocolId;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly scope: AuthScope;
}

export interface ControlCapabilityRequest { readonly token: string; readonly terminalSessionId: ProtocolId; readonly projectId: ProtocolId; readonly requiredScope?: AuthScope; }
export interface ControlRegistryOptions { readonly now?: () => number; readonly ttlMs?: number; readonly tokenFactory?: () => string; }

const ranks: Record<AuthScope, number> = { none: 0, read: 1, write: 2, admin: 3 };
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `tc_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Server-owned opaque capability registry. A copied PID, focus/window id, or
 * title is never used to authorize a control request. */
export class ControlCapabilityRegistry {
  private readonly capabilities = new Map<string, ControlCapability>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly tokenFactory: () => string;

  constructor(options: ControlRegistryOptions = {}) {
    this.now = options.now ?? Date.now; this.ttlMs = options.ttlMs ?? 15 * 60 * 1000; this.tokenFactory = options.tokenFactory ?? randomToken;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
  }

  mint(terminalSessionId: ProtocolId, projectId: ProtocolId, scope: AuthScope = "write"): ControlCapability {
    this.assertScope(scope); this.assertId(terminalSessionId); this.assertId(projectId);
    let token = this.tokenFactory(); while (this.capabilities.has(token)) token = this.tokenFactory();
    const issuedAt = this.now(); const capability: ControlCapability = Object.freeze({ token, terminalSessionId, projectId, scope, issuedAt, expiresAt: issuedAt + this.ttlMs });
    this.capabilities.set(token, capability); return capability;
  }

  rotate(terminalSessionId: ProtocolId, projectId: ProtocolId, scope: AuthScope = "write"): ControlCapability { this.revokeSession(terminalSessionId); return this.mint(terminalSessionId, projectId, scope); }
  revoke(token: string): boolean { return this.capabilities.delete(token); }
  revokeSession(terminalSessionId: ProtocolId): number { let count = 0; for (const [token, capability] of this.capabilities) if (capability.terminalSessionId === terminalSessionId) { this.capabilities.delete(token); count += 1; } return count; }
  onTerminalExit(terminalSessionId: ProtocolId): number { return this.revokeSession(terminalSessionId); }

  authorize(request: ControlCapabilityRequest): ControlCapability {
    const capability = this.capabilities.get(request.token);
    if (capability === undefined || capability.expiresAt <= this.now()) { if (capability !== undefined) this.capabilities.delete(request.token); throw new Error("control capability is unavailable"); }
    if (capability.terminalSessionId !== request.terminalSessionId || capability.projectId !== request.projectId) throw new Error("control capability scope mismatch");
    if (request.requiredScope !== undefined && ranks[capability.scope] < ranks[request.requiredScope]) throw new Error("control capability scope is insufficient");
    return capability;
  }

  metadata(): readonly Omit<ControlCapability, "token">[] { return [...this.capabilities.values()].map(({ token: _token, ...metadata }) => metadata); }
  private assertId(value: string): void { if (!idPattern.test(value)) throw new TypeError("invalid control scope id"); }
  private assertScope(value: string): asserts value is AuthScope { if (!(value in ranks)) throw new TypeError("invalid control scope"); }
}
