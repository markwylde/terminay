import type { ProtocolId } from "@terminay/protocol";

/** Connection state is deliberately independent from terminal/agent activity. */
export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "offline"
  | "relay-unavailable"
  | "webrtc-failed"
  | "expired"
  | "revoked"
  | "identity-mismatch"
  | "incompatible"
  | "unreachable";

export interface ConnectionProfile {
  readonly id: ProtocolId;
  readonly serverId: ProtocolId;
  readonly label: string;
  readonly origin: string;
  readonly status: ConnectionStatus;
  readonly createdAt: number;
  readonly lastOpenedAt?: number;
  readonly lastConnectedAt?: number;
  readonly archived?: boolean;
  readonly isLocal?: boolean;
}

export interface ConnectionProfileInput {
  readonly id?: ProtocolId;
  readonly serverId: ProtocolId;
  readonly label: string;
  readonly origin: string;
  readonly status?: ConnectionStatus;
  readonly createdAt?: number;
  readonly lastOpenedAt?: number;
  readonly lastConnectedAt?: number;
  readonly archived?: boolean;
  readonly isLocal?: boolean;
}

export interface ConnectionProfileStoreOptions {
  /** Desktop supplies Local by default. Browser hosts pass false so their
   * manager starts disconnected without fabricating an embedded server. */
  readonly local?: ConnectionProfileInput | false;
  readonly now?: () => number;
  readonly maxProfiles?: number;
}

export interface ConnectionProfileSnapshot {
  readonly revision: number;
  readonly currentProfileId?: ProtocolId;
  readonly profiles: readonly ConnectionProfile[];
}

export type ConnectionMenuAction =
  | "open"
  | "focus"
  | "switch"
  | "manage"
  | "retry"
  | "disconnect"
  | "forget"
  | "revoke"
  | "expose";

/** Pure host-local profile state. It stores no grants, keys, pairing URL
 * fragments, terminal data, project roots, or workspace fields. */
export class ConnectionProfileStore {
  private readonly profilesById = new Map<ProtocolId, ConnectionProfile>();
  private readonly now: () => number;
  private readonly maxProfiles: number;
  private readonly localId?: ProtocolId;
  private revisionValue = 0;
  private currentId: ProtocolId | undefined;

  constructor(options: ConnectionProfileStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxProfiles = positiveLimit(options.maxProfiles ?? 128, "maxProfiles");
    const localInput = options.local === false ? undefined : options.local ?? {
      id: "local",
      serverId: "local",
      label: "Local",
      origin: "http://127.0.0.1",
      status: "connected",
      isLocal: true,
    };
    if (localInput !== undefined) {
      const local = normalizeInput(localInput, this.now(), true);
      this.localId = local.id;
      this.currentId = local.id;
      this.profilesById.set(local.id, local);
    }
  }

  get revision(): number { return this.revisionValue; }
  get currentProfile(): ConnectionProfile | undefined { return this.currentId === undefined ? undefined : this.profilesById.get(this.currentId); }

  snapshot(): ConnectionProfileSnapshot {
    return Object.freeze({
      revision: this.revisionValue,
      ...(this.currentId === undefined ? {} : { currentProfileId: this.currentId }),
      profiles: Object.freeze([...this.profilesById.values()].map((profile) => Object.freeze({ ...profile }))),
    });
  }

  get(profileId: ProtocolId): ConnectionProfile | undefined { return this.profilesById.get(profileId); }

  /** Add or update sanitized metadata. The Local profile cannot be replaced. */
  remember(input: ConnectionProfileInput): ConnectionProfile {
    const existing = input.id === undefined ? undefined : this.profilesById.get(input.id);
    if (existing?.isLocal === true || input.isLocal === true && input.id !== this.localId) throw new Error("the Local profile is immutable");
    if (existing === undefined && this.profilesById.size >= this.maxProfiles) throw new Error("connection profile limit reached");
    const profile = normalizeInput({
      ...input,
      ...(existing === undefined ? {} : { id: existing.id, createdAt: existing.createdAt }),
      ...(input.lastOpenedAt === undefined && existing?.lastOpenedAt !== undefined ? { lastOpenedAt: existing.lastOpenedAt } : {}),
      ...(input.lastConnectedAt === undefined && existing?.lastConnectedAt !== undefined ? { lastConnectedAt: existing.lastConnectedAt } : {}),
    }, this.now(), false);
    this.profilesById.set(profile.id, profile);
    this.bump();
    return profile;
  }

  import(input: unknown): ConnectionProfile {
    if (!isRecord(input)) throw new TypeError("connection profile metadata is invalid");
    for (const key of Object.keys(input)) {
      if (FORBIDDEN_PROFILE_KEYS.has(key.toLowerCase())) throw new TypeError("connection profile contains forbidden credential data");
      // Migration is allowed to carry only this host-local profile DTO.  A
      // permissive import used to silently discard old renderer workspace,
      // terminal, and server-trust fields.  That made a compatibility adapter
      // look harmless while still accepting a second authority-shaped record.
      // Reject it instead: callers must explicitly migrate each authority to
      // its owning server store before remembering the connection metadata.
      if (!PROFILE_IMPORT_KEYS.has(key)) throw new TypeError("connection profile contains unsupported compatibility data");
    }
    return this.remember(input as unknown as ConnectionProfileInput);
  }

  select(profileId: ProtocolId): ConnectionProfile {
    const profile = this.require(profileId);
    if (profile.archived === true) throw new Error("archived connection profile cannot be selected");
    this.currentId = profile.id;
    const opened = Object.freeze({ ...profile, lastOpenedAt: this.now() });
    this.profilesById.set(profile.id, opened);
    this.bump();
    return opened;
  }

  markStatus(profileId: ProtocolId, status: ConnectionStatus): ConnectionProfile {
    const profile = this.require(profileId);
    const next = Object.freeze({ ...profile, status, ...(status === "connected" ? { lastConnectedAt: this.now() } : {}) });
    this.profilesById.set(profile.id, next);
    this.bump();
    return next;
  }

  /** Rename host-local display metadata. The embedded Local label is fixed. */
  rename(profileId: ProtocolId, label: string): ConnectionProfile {
    const profile = this.require(profileId);
    if (profile.isLocal === true || profile.id === this.localId) throw new Error("the Local profile is immutable");
    if (typeof label !== "string" || label.trim().length === 0 || label.length > 128 || hasControlCharacter(label)) throw new TypeError("connection label is invalid");
    const next = Object.freeze({ ...profile, label: label.trim() });
    this.profilesById.set(profile.id, next);
    this.bump();
    return next;
  }

  /** Archive host-local metadata without deleting credentials or server state. */
  archive(profileId: ProtocolId): ConnectionProfile {
    const profile = this.require(profileId);
    if (profile.isLocal === true || profile.id === this.localId) throw new Error("the Local profile cannot be archived");
    const next = Object.freeze({ ...profile, archived: true });
    this.profilesById.set(profile.id, next);
    if (this.currentId === profile.id) this.currentId = this.localId;
    this.bump();
    return next;
  }

  /** Restore an archived profile after an explicit management action. */
  unarchive(profileId: ProtocolId): ConnectionProfile {
    const profile = this.require(profileId);
    if (profile.isLocal === true || profile.id === this.localId) throw new Error("the Local profile cannot be archived");
    const next = Object.freeze({ ...profile, archived: false });
    this.profilesById.set(profile.id, next);
    this.bump();
    return next;
  }

  /** Disconnecting never removes the profile or changes the Local server. */
  disconnect(profileId: ProtocolId): ConnectionProfile { return this.markStatus(profileId, "offline"); }

  forget(profileId: ProtocolId, confirmed = false): boolean {
    const profile = this.require(profileId);
    if (profile.isLocal === true || profile.id === this.localId) throw new Error("the Local profile cannot be forgotten");
    if (!confirmed) throw new Error("forget requires confirmation");
    this.profilesById.delete(profile.id);
    if (this.currentId === profile.id) {
      this.currentId = this.localId;
    }
    this.bump();
    return true;
  }

  /** Mark a remote profile revoked only after an explicit user confirmation.
   * The host performs the server/device revocation separately; this local
   * metadata transition never claims that forgetting revoked access. */
  revoke(profileId: ProtocolId, confirmed = false): ConnectionProfile {
    const profile = this.require(profileId);
    if (profile.isLocal === true || profile.id === this.localId) throw new Error("the Local profile cannot be revoked");
    if (!confirmed) throw new Error("revoke requires confirmation");
    const next = Object.freeze({ ...profile, status: "revoked" as const });
    this.profilesById.set(profile.id, next);
    this.bump();
    return next;
  }

  availableActions(profileId: ProtocolId, options: { readonly canExpose?: boolean; readonly canRevoke?: boolean } = {}): readonly ConnectionMenuAction[] {
    const profile = this.require(profileId);
    const actions: ConnectionMenuAction[] = ["open", "focus", "switch", "manage"];
    if (profile.status !== "connected") actions.push("retry");
    if (profile.status === "connected") actions.push("disconnect");
    if (profile.isLocal !== true) actions.push("forget");
    if (options.canRevoke === true && profile.isLocal !== true) actions.push("revoke");
    if (options.canExpose === true && profile.id === this.currentId && profile.status === "connected") actions.push("expose");
    return Object.freeze(actions);
  }

  private require(profileId: ProtocolId): ConnectionProfile {
    const profile = this.profilesById.get(profileId);
    if (profile === undefined) throw new Error(`unknown connection profile: ${profileId}`);
    return profile;
  }

  private bump(): void {
    if (this.revisionValue === Number.MAX_SAFE_INTEGER) throw new RangeError("connection profile revision exhausted");
    this.revisionValue += 1;
  }
}

function normalizeInput(input: ConnectionProfileInput, now: number, forceLocal: boolean): ConnectionProfile {
  const id = input.id ?? `profile-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  assertId(id, "profile id");
  assertId(input.serverId, "server id");
  if (typeof input.label !== "string" || input.label.trim().length === 0 || input.label.length > 128) throw new TypeError("connection label is invalid");
  const origin = normalizeOrigin(input.origin);
  const status = input.status ?? "offline";
  if (!STATUSES.has(status)) throw new TypeError("connection status is invalid");
  const createdAt = input.createdAt ?? now;
  if (!Number.isFinite(createdAt) || createdAt < 0) throw new TypeError("connection createdAt is invalid");
  return Object.freeze({
    id,
    serverId: input.serverId,
    label: input.label.trim(),
    origin,
    status,
    createdAt,
    ...(input.lastOpenedAt === undefined ? {} : { lastOpenedAt: boundedTime(input.lastOpenedAt, "lastOpenedAt") }),
    ...(input.lastConnectedAt === undefined ? {} : { lastConnectedAt: boundedTime(input.lastConnectedAt, "lastConnectedAt") }),
    ...(input.archived === undefined ? {} : { archived: input.archived === true }),
    ...(forceLocal || input.isLocal === true ? { isLocal: true } : {}),
  });
}

function normalizeOrigin(raw: string): string {
  if (typeof raw !== "string" || raw.length > 2048) throw new TypeError("connection origin is invalid");
  let url: URL;
  try { url = new URL(raw); } catch { throw new TypeError("connection origin is invalid"); }
  const loopbackHttp = url.protocol === "http:" && (
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  );
  if (url.protocol !== "https:" && !loopbackHttp) throw new TypeError("connection origin must be HTTPS or loopback HTTP");
  if (url.username || url.password || url.search || url.hash) throw new TypeError("connection origin contains credentials or fragments");
  return url.origin;
}

function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`);
}

function boundedTime(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} is invalid`);
  return value;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUSES: ReadonlySet<string> = new Set<ConnectionStatus>([
  "connected", "connecting", "offline", "relay-unavailable", "webrtc-failed", "expired", "revoked", "identity-mismatch", "incompatible", "unreachable",
]);

const FORBIDDEN_PROFILE_KEYS: ReadonlySet<string> = new Set([
  "pairingurl", "pairingfragment", "pin", "devicekey", "privatekey", "proofkey", "signalingkey", "ticket", "token", "secret", "password",
]);

/** The exact persisted host-local DTO.  Server trust, credentials, workspace
 * state, terminal state, and presentation state are deliberately absent. */
const PROFILE_IMPORT_KEYS: ReadonlySet<string> = new Set([
  "id", "serverId", "label", "origin", "status", "createdAt",
  "lastOpenedAt", "lastConnectedAt", "archived", "isLocal",
]);
