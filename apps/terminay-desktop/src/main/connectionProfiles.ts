import type { ProtocolId } from "@terminay/protocol";

/** Host-local state deliberately excludes device keys, reconnect grants,
 * pairing fragments, and any server workspace data. */
export type ConnectionProfileStatus =
  | "known"
  | "connecting"
  | "connected"
  | "offline"
  | "expired"
  | "revoked"
  | "identity-mismatch"
  | "incompatible"
  | "failed"
  | "archived";

export interface ConnectionProfile {
  readonly id: string;
  readonly serverId: ProtocolId;
  readonly origin: string;
  readonly label: string;
  readonly serverDisplayName?: string;
  readonly fingerprint?: string;
  readonly kind: "local" | "remote";
  readonly immutable: boolean;
  readonly archived: boolean;
  readonly status: ConnectionProfileStatus;
  readonly createdAt: string;
  readonly lastOpenedAt?: string;
  readonly lastConnectedAt?: string;
}

export interface ConnectionProfilePatch {
  readonly label?: string;
  readonly serverDisplayName?: string;
  readonly fingerprint?: string;
  readonly status?: ConnectionProfileStatus;
  readonly lastOpenedAt?: string;
  readonly lastConnectedAt?: string;
}

export interface ConnectionProfileStorage {
  load(): readonly unknown[] | Promise<readonly unknown[]>;
  save(profiles: readonly ConnectionProfile[]): void | Promise<void>;
}

export interface ConnectionProfileDiagnostics {
  readonly id: string;
  readonly serverId: ProtocolId;
  readonly origin: string;
  readonly kind: "local" | "remote";
  readonly status: ConnectionProfileStatus;
  readonly archived: boolean;
  readonly lastOpenedAt?: string;
  readonly lastConnectedAt?: string;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:+/=-]{1,256}$/;
const ISO_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

function assertId(value: string, name: string): void {
  if (!ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("connection origin must be an absolute URL");
  }
  const loopbackHttp = parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !loopbackHttp) {
    throw new TypeError("connection origin must use HTTPS or embedded loopback HTTP");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new TypeError("connection origin must not contain credentials, path, query, or fragment");
  }
  return parsed.origin;
}

function normalizeLabel(value: string, field = "connection label"): string {
  const label = value.trim();
  if (label.length === 0 || label.length > 160 || hasControlCharacter(label)) throw new TypeError(`${field} is invalid`);
  return label;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function normalizeTimestamp(value: string, field: string): string {
  if (!ISO_PATTERN.test(value) || Number.isNaN(Date.parse(value))) throw new TypeError(`${field} is invalid`);
  return value;
}

function normalizeStatus(value: unknown): ConnectionProfileStatus {
  if (value === "known" || value === "connecting" || value === "connected" || value === "offline" ||
      value === "expired" || value === "revoked" || value === "identity-mismatch" || value === "incompatible" ||
      value === "failed" || value === "archived") return value;
  throw new TypeError("connection profile status is invalid");
}

function profileFromUnknown(value: unknown): ConnectionProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("connection profile must be an object");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["id", "serverId", "origin", "label", "serverDisplayName", "fingerprint", "kind", "immutable", "archived", "status", "createdAt", "lastOpenedAt", "lastConnectedAt"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`connection profile field is not allowed: ${key}`);
  const required = ["id", "serverId", "origin", "label", "kind", "immutable", "archived", "status", "createdAt"];
  for (const key of required) if (!(key in input)) throw new TypeError(`connection profile is missing ${key}`);
  if (typeof input.id !== "string") throw new TypeError("connection profile id is invalid");
  if (typeof input.serverId !== "string") throw new TypeError("connection profile server id is invalid");
  assertId(input.id, "connection profile id");
  assertId(input.serverId, "server id");
  if (typeof input.origin !== "string") throw new TypeError("connection origin is invalid");
  const origin = normalizeOrigin(input.origin);
  if (typeof input.label !== "string") throw new TypeError("connection label is invalid");
  const label = normalizeLabel(input.label);
  if (input.kind !== "local" && input.kind !== "remote") throw new TypeError("connection profile kind is invalid");
  if (typeof input.immutable !== "boolean" || typeof input.archived !== "boolean") throw new TypeError("connection profile flags are invalid");
  if (typeof input.createdAt !== "string") throw new TypeError("connection profile createdAt is invalid");
  const createdAt = normalizeTimestamp(input.createdAt, "connection profile createdAt");
  const status = normalizeStatus(input.status);
  if (input.kind === "local" && (!input.immutable || input.archived || label !== "Local")) throw new TypeError("Local profile is immutable and cannot be archived");
  if (input.kind === "remote" && input.immutable) throw new TypeError("remote profiles cannot be immutable");
  if (input.archived !== (status === "archived")) throw new TypeError("connection profile archive status is inconsistent");
  const optionalString = (key: string, max: number, pattern?: RegExp): string | undefined => {
    const candidate = input[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > max || (pattern !== undefined && !pattern.test(candidate))) throw new TypeError(`connection profile ${key} is invalid`);
    return candidate;
  };
  const serverDisplayName = optionalString("serverDisplayName", 160);
  const fingerprint = optionalString("fingerprint", 256, FINGERPRINT_PATTERN);
  const lastOpenedAt = input.lastOpenedAt === undefined ? undefined : normalizeTimestamp(String(input.lastOpenedAt), "connection profile lastOpenedAt");
  const lastConnectedAt = input.lastConnectedAt === undefined ? undefined : normalizeTimestamp(String(input.lastConnectedAt), "connection profile lastConnectedAt");
  return Object.freeze({
    id: input.id,
    serverId: input.serverId,
    origin,
    label,
    ...(serverDisplayName === undefined ? {} : { serverDisplayName }),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    kind: input.kind,
    immutable: input.immutable,
    archived: input.archived,
    status,
    createdAt,
    ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
    ...(lastConnectedAt === undefined ? {} : { lastConnectedAt }),
  });
}

export function localProfileId(serverId: ProtocolId): string {
  assertId(serverId, "server id");
  return `local:${serverId}`;
}

export interface LocalProfileInput {
  readonly serverId: ProtocolId;
  readonly origin: string;
  readonly fingerprint?: string;
  readonly now?: string;
}

export function createLocalProfile(input: LocalProfileInput): ConnectionProfile {
  assertId(input.serverId, "server id");
  const now = normalizeTimestamp(input.now ?? new Date().toISOString(), "profile timestamp");
  return profileFromUnknown({
    id: localProfileId(input.serverId),
    serverId: input.serverId,
    origin: input.origin,
    label: "Local",
    kind: "local",
    immutable: true,
    archived: false,
    status: "known",
    createdAt: now,
    ...(input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint }),
  });
}

export interface RemoteProfileInput {
  readonly id?: string;
  readonly serverId: ProtocolId;
  readonly origin: string;
  readonly label: string;
  readonly serverDisplayName?: string;
  readonly fingerprint?: string;
  readonly now?: string;
}

export function createRemoteProfile(input: RemoteProfileInput): ConnectionProfile {
  assertId(input.serverId, "server id");
  const now = normalizeTimestamp(input.now ?? new Date().toISOString(), "profile timestamp");
  const id = input.id ?? `remote:${input.serverId}`;
  assertId(id, "connection profile id");
  return profileFromUnknown({
    id,
    serverId: input.serverId,
    origin: input.origin,
    label: normalizeLabel(input.label),
    kind: "remote",
    immutable: false,
    archived: false,
    status: "known",
    createdAt: now,
    ...(input.serverDisplayName === undefined ? {} : { serverDisplayName: input.serverDisplayName }),
    ...(input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint }),
  });
}

export class ConnectionProfileStore {
  private readonly records = new Map<string, ConnectionProfile>();
  private readonly storage: ConnectionProfileStorage | undefined;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(options: { readonly initial?: readonly unknown[]; readonly storage?: ConnectionProfileStorage } = {}) {
    this.storage = options.storage;
    for (const raw of options.initial ?? []) this.insert(profileFromUnknown(raw));
  }

  async load(): Promise<void> {
    if (this.storage === undefined) return;
    const values = await this.storage.load();
    // Validate the complete persisted snapshot before touching live state.
    // A malformed disk record must not partially clear a usable connection
    // menu or leave it with only a subset of profiles.
    const parsed = parseConnectionProfiles(values);
    this.records.clear();
    for (const profile of parsed) this.insert(profile);
  }

  list(options: { readonly includeArchived?: boolean } = {}): readonly ConnectionProfile[] {
    const values = [...this.records.values()].filter((profile) => options.includeArchived === true || !profile.archived);
    values.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    return Object.freeze(values);
  }

  get(id: string): ConnectionProfile | undefined {
    return this.records.get(id);
  }

  ensureLocal(input: LocalProfileInput): ConnectionProfile {
    const profile = createLocalProfile(input);
    const prior = this.records.get(profile.id);
    const existingLocals = [...this.records.values()].filter((candidate) => candidate.kind === "local");
    if (existingLocals.some((candidate) => candidate.id !== profile.id)) {
      // A Desktop installation has exactly one embedded Local identity. A
      // changed server id must not silently create a second Local profile.
      throw new Error("Local server identity changed");
    }
    if (prior !== undefined) {
      if (prior.kind !== "local" || prior.serverId !== profile.serverId) throw new Error("Local server identity changed");
      if (prior.fingerprint !== undefined && profile.fingerprint !== undefined && prior.fingerprint !== profile.fingerprint) {
        throw new Error("Local server identity changed");
      }
      // The Local display name and identity are immutable. Its loopback port
      // may rotate after restart, so the origin is refreshed from readiness.
      const next = profileFromUnknown({ ...prior, origin: profile.origin, fingerprint: profile.fingerprint ?? prior.fingerprint, status: "known", archived: false });
      this.records.set(next.id, next);
      this.persist();
      return next;
    }
    this.insert(profile);
    this.persist();
    return profile;
  }

  add(profile: ConnectionProfile): ConnectionProfile {
    const normalized = profileFromUnknown(profile);
    if (normalized.kind === "local") throw new Error("Local profiles are created by ensureLocal");
    if (this.records.has(normalized.id)) throw new Error(`connection profile already exists: ${normalized.id}`);
    this.insert(normalized);
    this.persist();
    return normalized;
  }

  /** Import accepts only the same sanitized metadata shape used on disk. */
  import(value: unknown): ConnectionProfile {
    return this.add(profileFromUnknown(value));
  }

  rename(id: string, label: string): ConnectionProfile {
    return this.patch(id, { label });
  }

  diagnostics(id: string): ConnectionProfileDiagnostics {
    const profile = this.require(id);
    return Object.freeze({
      id: profile.id,
      serverId: profile.serverId,
      origin: profile.origin,
      kind: profile.kind,
      status: profile.status,
      archived: profile.archived,
      ...(profile.lastOpenedAt === undefined ? {} : { lastOpenedAt: profile.lastOpenedAt }),
      ...(profile.lastConnectedAt === undefined ? {} : { lastConnectedAt: profile.lastConnectedAt }),
    });
  }

  patch(id: string, patch: ConnectionProfilePatch): ConnectionProfile {
    const prior = this.require(id);
    if (prior.immutable && (patch.label !== undefined && patch.label !== prior.label)) throw new Error("Local profile label is immutable");
    const next = profileFromUnknown({
      ...prior,
      ...(patch.label === undefined ? {} : { label: normalizeLabel(patch.label) }),
      ...(patch.serverDisplayName === undefined ? {} : { serverDisplayName: normalizeLabel(patch.serverDisplayName, "server display name") }),
      ...(patch.fingerprint === undefined ? {} : { fingerprint: patch.fingerprint }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.lastOpenedAt === undefined ? {} : { lastOpenedAt: patch.lastOpenedAt }),
      ...(patch.lastConnectedAt === undefined ? {} : { lastConnectedAt: patch.lastConnectedAt }),
      ...(prior.immutable ? { archived: false } : {}),
      ...(patch.status !== undefined && patch.status !== "archived" ? { archived: false } : {}),
      ...(patch.status === "archived" ? { archived: true, status: "archived" } : {}),
    });
    this.records.set(id, next);
    this.persist();
    return next;
  }

  archive(id: string): ConnectionProfile {
    const prior = this.require(id);
    if (prior.immutable) throw new Error("Local profile cannot be archived");
    return this.patch(id, { status: "archived" });
  }

  /** Remove host-local metadata only after explicit user confirmation. The
   * host must revoke server/device access separately; forgetting cannot imply
   * or silently trigger that server-side action. */
  forget(id: string, confirmed = false): void {
    const prior = this.require(id);
    if (prior.immutable) throw new Error("Local profile cannot be forgotten");
    if (!confirmed) throw new Error("forget requires confirmation");
    this.records.delete(id);
    this.persist();
  }

  /** The host must revoke server access separately; this explicit metadata
   * transition prevents a profile from silently appearing usable again. */
  revoke(id: string, confirmed = false): ConnectionProfile {
    const prior = this.require(id);
    if (prior.immutable) throw new Error("Local profile cannot be revoked");
    if (!confirmed) throw new Error("revoke requires confirmation");
    return this.patch(id, { status: "revoked" });
  }

  /** Serialize only the documented non-secret metadata. */
  serialize(): readonly ConnectionProfile[] {
    return Object.freeze([...this.records.values()].map((profile) => Object.freeze({ ...profile })));
  }

  /** Await queued host-storage writes before app shutdown or a test assertion. */
  async flush(): Promise<void> {
    await this.writePromise;
  }

  private insert(profile: ConnectionProfile): void {
    if (this.records.has(profile.id)) throw new Error(`connection profile already exists: ${profile.id}`);
    this.records.set(profile.id, profile);
  }

  private require(id: string): ConnectionProfile {
    const profile = this.records.get(id);
    if (profile === undefined) throw new Error(`unknown connection profile: ${id}`);
    return profile;
  }

  private persist(): void {
    if (this.storage === undefined) return;
    const snapshot = this.serialize();
    this.writePromise = this.writePromise.then(() => this.storage?.save(snapshot)).then(() => undefined);
  }
}

/** Useful for tests and host adapters that need to consume persisted JSON.
 * Unknown fields are rejected, preventing secrets from being smuggled into the
 * connection-manager record. */
export function parseConnectionProfiles(value: unknown): readonly ConnectionProfile[] {
  if (!Array.isArray(value)) throw new TypeError("connection profile storage must be an array");
  const profiles = value.map(profileFromUnknown);
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new TypeError(`duplicate connection profile: ${profile.id}`);
    ids.add(profile.id);
  }
  return Object.freeze(profiles);
}
