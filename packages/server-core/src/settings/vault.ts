import type { ProtocolId } from "@terminay/protocol";
import type { SecretReference } from "./types.js";

/**
 * Server-side vault state.  The transport-facing shape intentionally carries
 * only metadata; a secret can cross this boundary only into `withSecret` and
 * is never returned by a vault command.
 */
export type VaultState = "unavailable" | "locked" | "unlocked";
export type VaultBackend = "embedded-safe-storage" | "headless-passphrase" | "custom";

export type VaultServiceErrorCode = "locked" | "unavailable" | "missing" | "invalid" | "failed";

/** Operation errors contain no adapter message, path, or secret material. */
export class VaultServiceError extends Error {
  readonly code: VaultServiceErrorCode;
  readonly operation: string;

  constructor(operation: string, code: VaultServiceErrorCode, message: string) {
    super(message);
    this.name = "VaultServiceError";
    this.operation = operation;
    this.code = code;
  }
}

export interface VaultStatus {
  readonly state: VaultState;
  readonly backend: VaultBackend;
  readonly revision: number;
  readonly entries: readonly SecretReference[];
}

export interface VaultSecretInput {
  readonly id: ProtocolId;
  readonly label?: string;
  /** Plaintext is accepted only at the privileged server boundary. */
  readonly value: Uint8Array;
}

export interface VaultUnlockRequest {
  /** A host-specific protector consumes this value and must not persist it. */
  readonly secret: Uint8Array;
}

/**
 * Adapter contract for the selected encrypted vault implementation.  An
 * Electron safe-storage adapter and a headless passphrase adapter implement
 * the same server boundary; neither adapter returns a plaintext value.
 */
export interface SecretVaultAdapter {
  readonly backend: VaultBackend;
  status(): VaultState;
  unlock(request: VaultUnlockRequest): Promise<void>;
  lock(): void | Promise<void>;
  list(): readonly SecretReference[];
  put(input: VaultSecretInput): Promise<SecretReference>;
  replace(input: VaultSecretInput): Promise<SecretReference>;
  test(id: ProtocolId): Promise<void>;
  remove(id: ProtocolId): Promise<boolean>;
  rotate(): Promise<void>;
  /** The callback executes inside the privileged server process. */
  withSecret<T>(id: ProtocolId, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T>;
}

export interface VaultMutationResult {
  readonly status: VaultStatus;
  readonly reference: SecretReference;
}

export interface VaultDeleteResult {
  readonly status: VaultStatus;
  readonly deleted: boolean;
}

export type VaultTestResult =
  | { readonly ok: true; readonly status: VaultStatus }
  | { readonly ok: false; readonly status: VaultStatus; readonly code: "missing" | "locked" | "unavailable" | "failed" };

export const MAX_VAULT_SECRET_BYTES = 1024 * 1024;
export const MAX_VAULT_UNLOCK_BYTES = 4096;
export const MAX_VAULT_LABEL_BYTES = 256;
export const VAULT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

/**
 * Transport-neutral server vault façade.  This class owns revisioning,
 * validation, metadata snapshots, and error shaping while an injected adapter
 * owns encryption, persistence, and platform key protection.
 */
export class ServerVaultService {
  private revisionValue = 0;

  constructor(private readonly adapter: SecretVaultAdapter) {
    if (!adapter || typeof adapter.status !== "function" || typeof adapter.list !== "function") {
      throw new TypeError("a vault adapter is required");
    }
  }

  get revision(): number {
    return this.revisionValue;
  }

  status(): VaultStatus {
    return this.snapshotStatus();
  }

  async unlock(request: VaultUnlockRequest): Promise<VaultStatus> {
    assertBytes(request?.secret, "unlock secret", MAX_VAULT_UNLOCK_BYTES);
    try {
      await this.adapter.unlock({ secret: new Uint8Array(request.secret) });
    } catch (error) {
      throw sanitizeVaultError("unlock", error, readAdapterState(this.adapter));
    } finally {
      // Do not retain an unlock key in this façade. Adapters are responsible
      // for clearing their own derived key material after use.
      request.secret.fill(0);
    }
    this.revisionValue += 1;
    return this.snapshotStatus();
  }

  async lock(): Promise<VaultStatus> {
    try {
      await this.adapter.lock();
    } catch (error) {
      throw sanitizeVaultError("lock", error, readAdapterState(this.adapter));
    }
    this.revisionValue += 1;
    return this.snapshotStatus();
  }

  /** Host lifecycle hook: a restart always begins with the vault locked. */
  async restartLock(): Promise<VaultStatus> {
    return this.lock();
  }

  async put(input: VaultSecretInput): Promise<VaultMutationResult> {
    const normalized = normalizeInput(input);
    let reference: SecretReference;
    try {
      reference = await this.adapter.put(normalized);
    } catch (error) {
      throw sanitizeVaultError("put", error, readAdapterState(this.adapter));
    } finally {
      normalized.value.fill(0);
    }
    this.revisionValue += 1;
    return { status: this.snapshotStatus(), reference: sanitizeReference(reference, normalized.id) };
  }

  async replace(input: VaultSecretInput): Promise<VaultMutationResult> {
    const normalized = normalizeInput(input);
    let reference: SecretReference;
    try {
      reference = await this.adapter.replace(normalized);
    } catch (error) {
      throw sanitizeVaultError("replace", error, readAdapterState(this.adapter));
    } finally {
      normalized.value.fill(0);
    }
    this.revisionValue += 1;
    return { status: this.snapshotStatus(), reference: sanitizeReference(reference, normalized.id) };
  }

  async test(id: ProtocolId): Promise<VaultTestResult> {
    const normalizedId = normalizeId(id);
    try {
      await this.adapter.test(normalizedId);
      return { ok: true, status: this.snapshotStatus() };
    } catch (error) {
      const code = classifyTestFailure(error, readAdapterState(this.adapter));
      return { ok: false, status: this.snapshotStatus(), code };
    }
  }

  async remove(id: ProtocolId): Promise<VaultDeleteResult> {
    const normalizedId = normalizeId(id);
    let deleted: boolean;
    try {
      deleted = await this.adapter.remove(normalizedId);
    } catch (error) {
      throw sanitizeVaultError("delete", error, readAdapterState(this.adapter));
    }
    if (deleted) this.revisionValue += 1;
    return { status: this.snapshotStatus(), deleted };
  }

  async rotate(): Promise<VaultStatus> {
    try {
      await this.adapter.rotate();
    } catch (error) {
      throw sanitizeVaultError("rotate", error, readAdapterState(this.adapter));
    }
    this.revisionValue += 1;
    return this.snapshotStatus();
  }

  /**
   * Resolve a value only for server-side work. The façade deliberately does
   * not provide a command result wrapper around this callback, so callers
   * cannot accidentally serialize a vault value as normal state.
   */
  withSecret<T>(id: ProtocolId, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T> {
    const normalizedId = normalizeId(id);
    if (typeof callback !== "function") throw new TypeError("secret callback is required");
    return this.adapter.withSecret(normalizedId, async (secret) => {
      assertBytes(secret, "adapter secret", MAX_VAULT_SECRET_BYTES);
      const scopedSecret = new Uint8Array(secret);
      try {
        return await callback(scopedSecret);
      } finally {
        scopedSecret.fill(0);
      }
    }).catch((error) => {
      throw sanitizeVaultError("read", error, readAdapterState(this.adapter));
    });
  }

  private snapshotStatus(): VaultStatus {
    let state = readAdapterState(this.adapter);
    let entries: readonly SecretReference[] = [];
    try {
      entries = this.adapter.list().map((entry) => sanitizeReference(entry));
    } catch {
      state = "unavailable";
    }
    return Object.freeze({
      state,
      backend: this.adapter.backend,
      revision: this.revisionValue,
      entries: Object.freeze(entries),
    });
  }
}

function normalizeInput(input: VaultSecretInput): VaultSecretInput {
  if (!input || typeof input !== "object") throw new TypeError("vault input is required");
  const id = normalizeId(input.id);
  assertBytes(input.value, "secret", MAX_VAULT_SECRET_BYTES);
  const label = normalizeLabel(input.label);
  return { id, ...(label === undefined ? {} : { label }), value: new Uint8Array(input.value) };
}

function normalizeId(value: ProtocolId): ProtocolId {
  if (typeof value !== "string" || !VAULT_ID_PATTERN.test(value)) throw new TypeError("vault secret id is invalid");
  return value;
}

function normalizeLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > MAX_VAULT_LABEL_BYTES) throw new RangeError("vault secret label exceeds the limit");
  return value;
}

function assertBytes(value: Uint8Array, name: string, maxBytes: number): void {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be bytes`);
  if (value.byteLength > maxBytes) throw new RangeError(`${name} exceeds the limit`);
}

function sanitizeReference(reference: SecretReference, fallbackId?: ProtocolId): SecretReference {
  if (!reference || typeof reference !== "object") throw new Error("vault adapter returned an invalid reference");
  const id = reference && typeof reference.id === "string" && VAULT_ID_PATTERN.test(reference.id) ? reference.id : fallbackId;
  if (id === undefined) throw new Error("vault adapter returned an invalid reference");
  const output: { id: string; configured: boolean; label?: string; version?: number; updatedAt?: number } = {
    id,
    configured: reference.configured === true,
  };
  if (typeof reference.label === "string") output.label = normalizeLabel(reference.label);
  if (Number.isSafeInteger(reference.version) && (reference.version as number) >= 0) output.version = reference.version;
  if (Number.isSafeInteger(reference.updatedAt) && (reference.updatedAt as number) >= 0) output.updatedAt = reference.updatedAt;
  return Object.freeze(output);
}

function normalizeState(value: VaultState): VaultState {
  if (value === "unavailable" || value === "locked" || value === "unlocked") return value;
  return "unavailable";
}

function classifyTestFailure(error: unknown, state: VaultState): "missing" | "locked" | "unavailable" | "failed" {
  if (state === "locked") return "locked";
  if (state === "unavailable") return "unavailable";
  if (error instanceof Error && /missing|not found|unknown/iu.test(error.message)) return "missing";
  return "failed";
}

function readAdapterState(adapter: SecretVaultAdapter): VaultState {
  try {
    return normalizeState(adapter.status());
  } catch {
    return "unavailable";
  }
}

function sanitizeVaultError(operation: string, error: unknown, state: VaultState): VaultServiceError {
  if (error instanceof Error && /missing|not found|unknown/iu.test(error.message)) return new VaultServiceError(operation, "missing", "missing secret");
  if (state === "locked") return new VaultServiceError(operation, "locked", "vault is locked");
  if (state === "unavailable") return new VaultServiceError(operation, "unavailable", "vault is unavailable");
  return new VaultServiceError(operation, "failed", "vault operation failed");
}
