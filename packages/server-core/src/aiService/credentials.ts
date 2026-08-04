import type { ProtocolId } from "@terminay/protocol";
import type { ServerVaultService } from "../settings/vault.js";
import { VAULT_ID_PATTERN } from "../settings/vault.js";
import { AiServiceError, type AiProviderCredentialResolver } from "./types.js";

/**
 * Server-side mapping from provider names to vault references. The mapping is
 * intentionally injected by the host so provider-specific secret naming stays
 * out of clients and out of the protocol.
 */
export interface ProviderSecretBinding {
  readonly provider: string;
  readonly secretId: ProtocolId;
}

export interface VaultProviderCredentialResolverOptions {
  readonly vault: Pick<ServerVaultService, "withSecret">;
  readonly bindings: readonly ProviderSecretBinding[];
}

/**
 * Resolves an AI provider credential only for the duration of a privileged
 * adapter callback. `ServerVaultService` copies and zeroizes the scoped bytes;
 * this resolver never returns a credential as an operation result.
 */
export class VaultProviderCredentialResolver implements AiProviderCredentialResolver {
  private readonly vault: Pick<ServerVaultService, "withSecret">;
  private readonly bindings: ReadonlyMap<string, ProtocolId>;

  constructor(options: VaultProviderCredentialResolverOptions) {
    if (!options?.vault || typeof options.vault.withSecret !== "function") throw new TypeError("a server vault is required");
    if (!Array.isArray(options.bindings)) throw new TypeError("provider credential bindings are required");
    const bindings = new Map<string, ProtocolId>();
    for (const binding of options.bindings) {
      if (!binding || typeof binding.provider !== "string") throw new TypeError("provider credential binding is invalid");
      const provider = normalizeProvider(binding.provider);
      if (provider === "disabled") throw new TypeError("disabled provider cannot have a credential binding");
      if (typeof binding.secretId !== "string" || !VAULT_ID_PATTERN.test(binding.secretId)) throw new TypeError("provider credential secret id is invalid");
      if (bindings.has(provider)) throw new TypeError("provider credential binding is duplicated");
      bindings.set(provider, binding.secretId);
    }
    this.vault = options.vault;
    this.bindings = bindings;
  }

  withCredential<T>(providerInput: string, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T> {
    if (typeof callback !== "function") return Promise.reject(new TypeError("credential callback is required"));
    let provider: string;
    try {
      provider = normalizeProvider(providerInput);
    } catch {
      return Promise.reject(new AiServiceError("provider_unavailable", "provider credential is unavailable.", true));
    }
    const secretId = this.bindings.get(provider);
    if (secretId === undefined) return Promise.reject(new AiServiceError("provider_unavailable", "provider credential is unavailable.", true));
    let callbackFailed = false;
    return this.vault.withSecret(secretId, async (secret) => {
      try {
        return await callback(secret);
      } catch (error) {
        callbackFailed = true;
        throw error;
      }
    }).catch((error: unknown) => {
      if (callbackFailed) throw error;
      // Vault/backend errors may include paths, provider diagnostics, or
      // accidental plaintext. Keep this transport-safe and deterministic.
      throw new AiServiceError("provider_unavailable", "provider credential is unavailable.", true);
    });
  }
}

export const ServerProviderCredentialResolver = VaultProviderCredentialResolver;

function normalizeProvider(value: string): string {
  const normalized = value.trim();
  if (normalized === "claudeCode") return "claude-code";
  if (normalized === "codex" || normalized === "claude-code") return normalized;
  if (normalized.length === 0 || normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)) {
    throw new TypeError("provider credential binding is invalid");
  }
  return normalized;
}
