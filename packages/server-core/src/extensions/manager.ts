import type { ExtensionBroker, ExtensionHostLimits, ExtensionHostStatus, ExtensionInvocation, ExtensionLaunchDescriptor, ExtensionProfileBroker, ExtensionProviderInvocation, ExtensionSecretAccessBroker, ExtensionSshAgentBroker } from "./types.js";
import { ExtensionHost } from "./host.js";

export interface ExtensionHostManagerOptions {
  readonly broker: ExtensionBroker;
  readonly limits?: ExtensionHostLimits;
  readonly nodeExecutable?: string;
  readonly profiles?: ExtensionProfileBroker;
  readonly secrets?: ExtensionSecretAccessBroker;
  readonly sshAgent?: ExtensionSshAgentBroker;
}

/** Owns independent per-extension supervisors. No extension failure is allowed
 * to escape manager lifecycle methods or affect another host. */
export class ExtensionHostManager {
  private readonly hosts = new Map<string, ExtensionHost>();
  private readonly providerOwners = new Map<string, string>();
  constructor(private readonly options: ExtensionHostManagerOptions) {}

  statuses(): readonly ExtensionHostStatus[] { return Object.freeze([...this.hosts.values()].map((host) => host.status()).sort((a, b) => a.extensionId.localeCompare(b.extensionId))); }

  async start(descriptor: ExtensionLaunchDescriptor): Promise<ExtensionHostStatus> {
    let host = this.hosts.get(descriptor.extensionId);
    if (host === undefined) {
      host = new ExtensionHost(descriptor.extensionId, this.options);
      this.hosts.set(descriptor.extensionId, host);
    }
    await host.start(descriptor);
    for (const provider of host.status().providers ?? []) {
      const owner = this.providerOwners.get(provider.providerId);
      if (owner !== undefined && owner !== descriptor.extensionId) { await host.stop(); throw new Error(`project environment provider already registered: ${provider.providerId}`); }
      this.providerOwners.set(provider.providerId, descriptor.extensionId);
    }
    return host.status();
  }

  providerDefinitions() { return Object.freeze(this.statuses().flatMap((status) => status.state === "running" ? status.providers ?? [] : [])); }

  invokeProvider(invocation: ExtensionProviderInvocation): Promise<unknown> {
    const owner = this.providerOwners.get(invocation.providerId);
    if (owner === undefined) return Promise.reject(new Error("extension provider is unavailable"));
    const host = this.hosts.get(owner);
    if (host === undefined) return Promise.reject(new Error("extension host does not exist"));
    return host.invokeProvider(invocation);
  }

  invoke(extensionId: string, invocation: ExtensionInvocation): Promise<unknown> {
    const host = this.hosts.get(extensionId);
    if (host === undefined) return Promise.reject(new Error("extension host does not exist"));
    return host.invoke(invocation);
  }

  async stop(extensionId: string): Promise<void> {
    await this.hosts.get(extensionId)?.stop();
    for (const [providerId, owner] of this.providerOwners) if (owner === extensionId) this.providerOwners.delete(providerId);
  }

  async shutdown(): Promise<void> {
    const results = await Promise.allSettled([...this.hosts.values()].map((host) => host.stop()));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), "extension host shutdown failed");
  }
}
