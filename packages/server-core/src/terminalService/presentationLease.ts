import { TerminalServiceError } from "./errors.js";
import type { TerminalIdentity } from "./types.js";

export type TerminalPresentationLeaseMode = "acquire" | "renew" | "takeover" | "release" | "revoke";

export interface TerminalPresentationLeaseIdentity extends TerminalIdentity {
  readonly clientId: string;
  readonly attachmentId: string;
}

export interface TerminalPresentationLeaseState extends TerminalIdentity {
  readonly revision: number;
  readonly holder?: Readonly<{
    clientId: string;
    attachmentId: string;
    leaseExpiresAt: number;
  }>;
}

export interface TerminalPresentationLeaseOptions {
  readonly leaseMs?: number;
  readonly maxLeaseMs?: number;
  readonly now?: () => number;
  readonly onChanged?: (state: TerminalPresentationLeaseState, action: TerminalPresentationLeaseMode) => void;
}

interface MutableLease {
  identity: TerminalPresentationLeaseIdentity;
  leaseExpiresAt: number;
}

const DEFAULT_LEASE_MS = 15_000;
const DEFAULT_MAX_LEASE_MS = 60_000;

/** Server-authoritative interactive-emulator ownership for one exact PTY. */
export class TerminalPresentationLeaseAuthority {
  private readonly leaseMs: number;
  private readonly maxLeaseMs: number;
  private readonly now: () => number;
  private readonly onChanged: TerminalPresentationLeaseOptions["onChanged"];
  private readonly leases = new Map<string, MutableLease>();
  private readonly revisions = new Map<string, number>();

  constructor(options: TerminalPresentationLeaseOptions = {}) {
    this.maxLeaseMs = positiveLease(options.maxLeaseMs ?? DEFAULT_MAX_LEASE_MS, Number.MAX_SAFE_INTEGER);
    this.leaseMs = positiveLease(options.leaseMs ?? DEFAULT_LEASE_MS, this.maxLeaseMs);
    this.now = options.now ?? (() => Date.now());
    this.onChanged = options.onChanged;
  }

  state(identity: TerminalIdentity): TerminalPresentationLeaseState {
    const key = sessionKey(identity);
    const lease = this.current(key);
    return freezeState(identity, this.revisions.get(key) ?? 0, lease);
  }

  change(mode: TerminalPresentationLeaseMode, identity: TerminalPresentationLeaseIdentity, options: { leaseMs?: number; admin?: boolean } = {}): TerminalPresentationLeaseState {
    const key = sessionKey(identity);
    const current = this.current(key);
    if (mode === "release") {
      if (current === undefined) return this.state(identity);
      this.assertSameHolder(current, identity);
      return this.commit(key, identity, undefined, mode);
    }
    if (mode === "revoke") {
      if (options.admin !== true) throw new TerminalServiceError("forbidden", "terminal presentation revocation requires admin access", { reason: "presentation_admin" });
      if (current === undefined) return this.state(identity);
      return this.commit(key, identity, undefined, mode);
    }
    if (mode === "renew") {
      if (current === undefined) throw new TerminalServiceError("forbidden", "terminal presentation lease has expired", { reason: "presentation_owner" });
      this.assertSameHolder(current, identity);
    }
    if (mode === "acquire" && current !== undefined) {
      this.assertSameHolder(current, identity);
    }
    // A takeover is an explicit user action. Server command serialization is
    // the deterministic tie-breaker for simultaneous requests.
    const leaseExpiresAt = this.now() + positiveLease(options.leaseMs ?? this.leaseMs, this.maxLeaseMs);
    return this.commit(key, identity, { identity: { ...identity }, leaseExpiresAt }, mode);
  }

  assertHolder(identity: TerminalPresentationLeaseIdentity): TerminalPresentationLeaseState {
    const current = this.current(sessionKey(identity));
    if (current === undefined) throw new TerminalServiceError("forbidden", "terminal presentation is read-only", { reason: "presentation_owner" });
    this.assertSameHolder(current, identity);
    return this.state(identity);
  }

  releaseAttachment(identity: TerminalPresentationLeaseIdentity): boolean {
    const key = sessionKey(identity);
    const current = this.current(key);
    if (current === undefined || !sameHolder(current.identity, identity)) return false;
    this.commit(key, identity, undefined, "release");
    return true;
  }

  releaseClient(identity: TerminalIdentity, clientId: string): boolean {
    const key = sessionKey(identity);
    const current = this.current(key);
    if (current === undefined || current.identity.clientId !== clientId) return false;
    this.commit(key, identity, undefined, "release");
    return true;
  }

  private current(key: string): MutableLease | undefined {
    const current = this.leases.get(key);
    if (current !== undefined && current.leaseExpiresAt <= this.now()) {
      this.leases.delete(key);
      const revision = (this.revisions.get(key) ?? 0) + 1;
      this.revisions.set(key, revision);
      const identity = current.identity;
      this.onChanged?.(freezeState(identity, revision, undefined), "release");
      return undefined;
    }
    return current;
  }

  private assertSameHolder(current: MutableLease, identity: TerminalPresentationLeaseIdentity): void {
    if (!sameHolder(current.identity, identity)) throw new TerminalServiceError("forbidden", "terminal presentation is controlled by another attachment", { reason: "presentation_owner", actual: current.identity.clientId });
  }

  private commit(key: string, identity: TerminalIdentity, lease: MutableLease | undefined, action: TerminalPresentationLeaseMode): TerminalPresentationLeaseState {
    if (lease === undefined) this.leases.delete(key); else this.leases.set(key, lease);
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    const state = freezeState(identity, revision, lease);
    this.onChanged?.(state, action);
    return state;
  }
}

function sameHolder(left: TerminalPresentationLeaseIdentity, right: TerminalPresentationLeaseIdentity): boolean {
  return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId && left.clientId === right.clientId && left.attachmentId === right.attachmentId;
}

function sessionKey(identity: TerminalIdentity): string { return `${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}`; }

function positiveLease(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new RangeError("terminal presentation lease is out of bounds");
  return value;
}

function freezeState(identity: TerminalIdentity, revision: number, lease: MutableLease | undefined): TerminalPresentationLeaseState {
  return Object.freeze({
    serverId: identity.serverId,
    projectId: identity.projectId,
    sessionId: identity.sessionId,
    revision,
    ...(lease === undefined ? {} : { holder: Object.freeze({ clientId: lease.identity.clientId, attachmentId: lease.identity.attachmentId, leaseExpiresAt: lease.leaseExpiresAt }) }),
  });
}
