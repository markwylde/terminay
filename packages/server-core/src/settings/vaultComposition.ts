import {
  ExtensionSecretBroker,
  type ExtensionSecretBinding,
  type ExtensionSecretBrokerOptions,
} from "./extensionSecretBroker.js";
import {
  ServerVaultService,
  type SecretVaultAdapter,
  type VaultStatus,
  type VaultUnlockRequest,
} from "./vault.js";

export interface ServerVaultCompositionOptions extends ExtensionSecretBrokerOptions {
  readonly bindings?: readonly ExtensionSecretBinding[];
}

/**
 * Host-neutral vault composition used by both Electron safe-storage and
 * headless passphrase adapters. Hosts select/provision the protector; server
 * services and extension children receive this identical boundary.
 */
export class ServerVaultComposition {
  readonly vault: ServerVaultService;
  readonly extensionSecrets: ExtensionSecretBroker;

  constructor(adapter: SecretVaultAdapter, options: ServerVaultCompositionOptions = {}) {
    this.vault = new ServerVaultService(adapter);
    this.extensionSecrets = new ExtensionSecretBroker(
      this.vault,
      options.bindings ?? [],
      options.authorize === undefined ? {} : { authorize: options.authorize },
    );
  }

  status(): VaultStatus {
    return this.vault.status();
  }

  /** The input is copied into the adapter boundary and always zeroized by the
   * common vault façade, independent of the selected protector. */
  unlock(request: VaultUnlockRequest): Promise<VaultStatus> {
    return this.vault.unlock(request);
  }

  lock(): Promise<VaultStatus> {
    return this.vault.lock();
  }
}

export function createServerVaultComposition(
  adapter: SecretVaultAdapter,
  options: ServerVaultCompositionOptions = {},
): ServerVaultComposition {
  return new ServerVaultComposition(adapter, options);
}
