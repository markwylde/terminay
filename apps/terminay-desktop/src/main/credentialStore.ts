import type { ProtocolId } from "@terminay/protocol";

export type ConnectionCredentialKind = "device-key";

export interface ConnectionCredentialIdentity {
  readonly profileId: string;
  readonly serverId: ProtocolId;
  readonly origin: string;
  readonly kind: ConnectionCredentialKind;
}

export interface ConnectionCredential extends ConnectionCredentialIdentity {
  readonly secret: string;
}

export type SecureStorageUnavailableReason =
  | "not-configured"
  | "unavailable"
  | "locked"
  | "backend-error"
  | "corrupt-record";

export type SecureCredentialStoreStatus =
  | { readonly status: "available"; readonly backend: "os" }
  | { readonly status: "degraded"; readonly reason: SecureStorageUnavailableReason; readonly action: "re-pair" };

export type SecureCredentialStoreResult<T = undefined> =
  | { readonly status: "available"; readonly backend: "os"; readonly value?: T }
  | Extract<SecureCredentialStoreStatus, { readonly status: "degraded" }>;

/**
 * Privileged Electron code adapts safeStorage/keychain/Keychain Services to
 * this boundary. The desktop host never writes a plaintext fallback when the
 * OS protector is absent or locked.
 */
export interface SecureCredentialBackend {
  status(): SecureCredentialStoreStatus | Promise<SecureCredentialStoreStatus>;
  read(key: string): string | undefined | Promise<string | undefined>;
  write(key: string, value: string): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECRET_MAX_LENGTH = 65_536;
const CREDENTIAL_KEY_PREFIX = "terminay.connection-credential.";

function assertId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}

function normalizeOrigin(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("credential origin is invalid");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("credential origin is invalid");
  }
  const loopbackHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !loopbackHttp) throw new TypeError("credential origin must use HTTPS or embedded loopback HTTP");
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new TypeError("credential origin must not contain credentials, path, query, or fragment");
  return parsed.origin;
}

function normalizeIdentity(value: unknown): ConnectionCredentialIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("credential identity is required");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["profileId", "serverId", "origin", "kind"].includes(key))) throw new TypeError("credential identity contains an unknown field");
  assertId(input.profileId, "credential profile id");
  assertId(input.serverId, "credential server id");
  const origin = normalizeOrigin(input.origin);
  if (input.kind !== "device-key") throw new TypeError("credential kind is invalid");
  return Object.freeze({ profileId: input.profileId, serverId: input.serverId, origin, kind: input.kind });
}

function normalizeSecret(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > SECRET_MAX_LENGTH) throw new TypeError("credential secret is invalid");
  return value;
}

function normalizeCredential(value: unknown): ConnectionCredential {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("stored credential is invalid");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["profileId", "serverId", "origin", "kind", "secret"].includes(key))) throw new TypeError("stored credential contains an unknown field");
  const identity = normalizeIdentity({ profileId: input.profileId, serverId: input.serverId, origin: input.origin, kind: input.kind });
  return Object.freeze({ ...identity, secret: normalizeSecret(input.secret) });
}

function sameIdentity(left: ConnectionCredentialIdentity, right: ConnectionCredentialIdentity): boolean {
  return left.profileId === right.profileId && left.serverId === right.serverId && left.origin === right.origin && left.kind === right.kind;
}

function credentialKey(identity: ConnectionCredentialIdentity): string {
  return `${CREDENTIAL_KEY_PREFIX}${encodeURIComponent(identity.profileId)}.${identity.kind}`;
}

function degraded(reason: SecureStorageUnavailableReason): Extract<SecureCredentialStoreStatus, { readonly status: "degraded" }> {
  return Object.freeze({ status: "degraded", reason, action: "re-pair" });
}

function available(): Extract<SecureCredentialStoreStatus, { readonly status: "available" }> {
  return Object.freeze({ status: "available", backend: "os" });
}

/**
 * Host-local credential storage with an explicit fail-closed degraded mode.
 * A degraded result tells the caller to ask for fresh pairing; `undefined`
 * is reserved for an available store with no credential at that key.
 */
export class SecureCredentialStore {
  private readonly backend: SecureCredentialBackend | undefined;

  constructor(backend?: SecureCredentialBackend) {
    this.backend = backend;
  }

  async status(): Promise<SecureCredentialStoreStatus> {
    if (this.backend === undefined) return degraded("not-configured");
    try {
      const result = await this.backend.status();
      if (result.status === "available" && result.backend === "os") return available();
      if (result.status === "degraded" && (result.reason === "unavailable" || result.reason === "locked" || result.reason === "backend-error")) return degraded(result.reason);
      return degraded("backend-error");
    } catch {
      return degraded("backend-error");
    }
  }

  async save(identity: ConnectionCredentialIdentity, secret: string): Promise<SecureCredentialStoreResult> {
    const normalizedIdentity = normalizeIdentity(identity);
    const normalizedSecret = normalizeSecret(secret);
    const state = await this.status();
    if (state.status === "degraded") return state;
    try {
      await this.backend!.write(credentialKey(normalizedIdentity), JSON.stringify({ ...normalizedIdentity, secret: normalizedSecret }));
      return state;
    } catch {
      return degraded("backend-error");
    }
  }

  async load(identity: ConnectionCredentialIdentity): Promise<SecureCredentialStoreResult<ConnectionCredential>> {
    const normalizedIdentity = normalizeIdentity(identity);
    const state = await this.status();
    if (state.status === "degraded") return state;
    let raw: string | undefined;
    try {
      raw = await this.backend!.read(credentialKey(normalizedIdentity));
    } catch {
      return degraded("backend-error");
    }
    if (raw === undefined) return state;
    try {
      const credential = normalizeCredential(JSON.parse(raw) as unknown);
      if (!sameIdentity(credential, normalizedIdentity)) {
        // The key is scoped by profile and credential kind, so a record with a
        // different server/origin is not merely absent: it is stale identity
        // state. Retire it before asking the user to pair again; otherwise a
        // later reconnect could repeatedly encounter the mismatched secret.
        return await this.retireInvalidRecord(normalizedIdentity);
      }
      return Object.freeze({ ...state, value: credential });
    } catch {
      // Do not expose backend contents or parser errors; re-pair is the only
      // safe recovery when a secure record is not structurally trustworthy.
      return this.retireInvalidRecord(normalizedIdentity);
    }
  }

  async remove(identity: ConnectionCredentialIdentity): Promise<SecureCredentialStoreResult> {
    const normalizedIdentity = normalizeIdentity(identity);
    const state = await this.status();
    if (state.status === "degraded") return state;
    try {
      await this.backend!.delete(credentialKey(normalizedIdentity));
      return state;
    } catch {
      return degraded("backend-error");
    }
  }

  /**
   * An invalid record must never remain a candidate for a later reconnect.
   * Deletion is deliberately best-effort only in the sense that its failure is
   * reported as a secure-storage failure, never masked as a clean re-pair.
   */
  private async retireInvalidRecord(identity: ConnectionCredentialIdentity): Promise<SecureCredentialStoreResult<ConnectionCredential>> {
    try {
      await this.backend!.delete(credentialKey(identity));
      return degraded("corrupt-record");
    } catch {
      return degraded("backend-error");
    }
  }
}
