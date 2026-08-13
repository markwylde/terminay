import type { ProtocolId } from "@terminay/protocol";
import type { ServerVaultService } from "./vault.js";

export const EXTENSION_SECRET_RESOLVE_PERMISSION = "extension-secrets:resolve";

export type ExtensionSecretBrokerErrorCode =
  | "denied"
  | "missing"
  | "locked"
  | "unavailable"
  | "failed";

export class ExtensionSecretBrokerError extends Error {
  readonly code: ExtensionSecretBrokerErrorCode;

  constructor(code: ExtensionSecretBrokerErrorCode, message: string) {
    super(message);
    this.name = "ExtensionSecretBrokerError";
    this.code = code;
  }
}

/** A server-owned binding. The vault id is deliberately absent from requests
 * made by an extension child and from all broker results. */
export interface ExtensionSecretBinding {
  readonly extensionId: ProtocolId;
  readonly profileId: ProtocolId;
  readonly fieldId: ProtocolId;
  readonly secretId: ProtocolId;
}

/** Identity and grants are injected by the authenticated extension-host
 * session. They must never be accepted from an extension IPC payload. */
export interface ExtensionSecretPrincipal {
  readonly extensionId: ProtocolId;
  readonly permissions: ReadonlySet<string>;
  readonly sessionId?: ProtocolId;
}

export interface ExtensionSecretRequest {
  readonly profileId: ProtocolId;
  readonly fieldId: ProtocolId;
}

export type ExtensionSecretAuthorizer = (
  principal: ExtensionSecretPrincipal,
  binding: Readonly<Omit<ExtensionSecretBinding, "secretId">>,
) => boolean | Promise<boolean>;

export interface ExtensionSecretBrokerOptions {
  readonly authorize?: ExtensionSecretAuthorizer;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

/**
 * Resolves only an extension's own profile-bound fields. This is an
 * authorization and lifetime boundary, not an operating-system sandbox.
 */
export class ExtensionSecretBroker {
  private readonly bindings = new Map<string, ExtensionSecretBinding>();
  private readonly authorize: ExtensionSecretAuthorizer;

  constructor(
    private readonly vault: Pick<ServerVaultService, "withSecret">,
    bindings: readonly ExtensionSecretBinding[] = [],
    options: ExtensionSecretBrokerOptions = {},
  ) {
    if (!vault || typeof vault.withSecret !== "function") {
      throw new TypeError("server vault is required");
    }
    this.authorize = options.authorize ?? (() => true);
    this.replaceBindings(bindings);
  }

  /** Replace the canonical metadata snapshot atomically. Duplicate ownership
   * keys are rejected rather than selected by insertion order. */
  replaceBindings(bindings: readonly ExtensionSecretBinding[]): void {
    if (!Array.isArray(bindings)) throw new TypeError("secret bindings must be an array");
    const next = new Map<string, ExtensionSecretBinding>();
    for (const candidate of bindings) {
      const binding = normalizeBinding(candidate);
      const key = bindingKey(binding.extensionId, binding.profileId, binding.fieldId);
      if (next.has(key)) throw new TypeError("duplicate extension secret binding");
      next.set(key, binding);
    }
    this.bindings.clear();
    for (const [key, binding] of next) this.bindings.set(key, binding);
  }

  upsertBinding(binding: ExtensionSecretBinding): void { const normalized = normalizeBinding(binding); this.bindings.set(bindingKey(normalized.extensionId, normalized.profileId, normalized.fieldId), normalized); }
  removeBinding(extensionId: ProtocolId, profileId: ProtocolId, fieldId: ProtocolId): void { this.bindings.delete(bindingKey(extensionId, profileId, fieldId)); }

  /**
   * Plaintext exists only for the duration of callback execution. A distinct
   * broker-owned copy is cleared even when authorization, vault access, or the
   * consumer callback fails.
   */
  async withSecret<T>(
    principalInput: ExtensionSecretPrincipal,
    requestInput: ExtensionSecretRequest,
    callback: (secret: Uint8Array) => T | Promise<T>,
  ): Promise<T> {
    const principal = normalizePrincipal(principalInput);
    const request = normalizeRequest(requestInput);
    if (typeof callback !== "function") throw new TypeError("secret callback is required");
    if (!principal.permissions.has(EXTENSION_SECRET_RESOLVE_PERMISSION)) {
      throw denied();
    }
    const binding = this.bindings.get(bindingKey(principal.extensionId, request.profileId, request.fieldId));
    if (binding === undefined) throw denied();
    let authorized = false;
    try {
      authorized = await this.authorize(principal, Object.freeze({
        extensionId: binding.extensionId,
        profileId: binding.profileId,
        fieldId: binding.fieldId,
      }));
    } catch {
      throw denied();
    }
    if (!authorized) throw denied();

    try {
      return await this.vault.withSecret(binding.secretId, async (vaultBytes) => {
        const scoped = new Uint8Array(vaultBytes);
        try {
          return await callback(scoped);
        } finally {
          scoped.fill(0);
        }
      });
    } catch (error) {
      if (error instanceof ExtensionSecretBrokerError) throw error;
      throw mapVaultFailure(error);
    }
  }
}

function normalizeBinding(value: ExtensionSecretBinding): ExtensionSecretBinding {
  if (!value || typeof value !== "object") throw new TypeError("secret binding is required");
  return Object.freeze({
    extensionId: normalizeId(value.extensionId, "extension id"),
    profileId: normalizeId(value.profileId, "profile id"),
    fieldId: normalizeId(value.fieldId, "field id"),
    secretId: normalizeId(value.secretId, "secret id"),
  });
}

function normalizePrincipal(value: ExtensionSecretPrincipal): ExtensionSecretPrincipal {
  if (!value || typeof value !== "object" || !(value.permissions instanceof Set)) {
    throw new TypeError("extension secret principal is invalid");
  }
  for (const permission of value.permissions) {
    if (typeof permission !== "string" || permission.length === 0 || permission.length > 128) {
      throw new TypeError("extension secret permission is invalid");
    }
  }
  return Object.freeze({
    extensionId: normalizeId(value.extensionId, "extension id"),
    permissions: new Set(value.permissions),
    ...(value.sessionId === undefined ? {} : { sessionId: normalizeId(value.sessionId, "session id") }),
  });
}

function normalizeRequest(value: ExtensionSecretRequest): ExtensionSecretRequest {
  if (!value || typeof value !== "object") throw new TypeError("extension secret request is invalid");
  return Object.freeze({
    profileId: normalizeId(value.profileId, "profile id"),
    fieldId: normalizeId(value.fieldId, "field id"),
  });
}

function normalizeId(value: unknown, name: string): ProtocolId {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function bindingKey(extensionId: string, profileId: string, fieldId: string): string {
  return `${extensionId}\0${profileId}\0${fieldId}`;
}

function denied(): ExtensionSecretBrokerError {
  return new ExtensionSecretBrokerError("denied", "extension secret access is denied");
}

function mapVaultFailure(error: unknown): ExtensionSecretBrokerError {
  const code = readErrorCode(error);
  if (code === "locked") return new ExtensionSecretBrokerError("locked", "server vault is locked");
  if (code === "unavailable") return new ExtensionSecretBrokerError("unavailable", "server vault is unavailable");
  if (code === "missing") return new ExtensionSecretBrokerError("missing", "extension secret is not configured");
  return new ExtensionSecretBrokerError("failed", "extension secret resolution failed");
}

function readErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}
