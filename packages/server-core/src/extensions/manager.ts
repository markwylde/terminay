import type { ExtensionAgentBroker, ExtensionAgentTerminalAdmission, ExtensionAgentTerminalCancellation, ExtensionBroker, ExtensionDependencyCall, ExtensionHostLimits, ExtensionHostStatus, ExtensionInvocation, ExtensionLaunchDescriptor, ExtensionProfileBroker, ExtensionProviderInvocation, ExtensionSecretAccessBroker, ExtensionSshAgentBroker } from "./types.js";
import { ExtensionHost } from "./host.js";
import { ExtensionProviderVault } from "./providerVault.js";
import type { ServerVaultService } from "../settings/vault.js";

export interface ExtensionHostManagerOptions {
  readonly broker: ExtensionBroker;
  readonly childEntrypoint?: string;
  readonly limits?: ExtensionHostLimits;
  readonly nodeExecutable?: string;
  readonly profiles?: ExtensionProfileBroker;
  readonly secrets?: ExtensionSecretAccessBroker;
  readonly sshAgent?: ExtensionSshAgentBroker;
  readonly agents?: ExtensionAgentBroker;
  readonly vault?: ServerVaultService;
}

/** Owns independent per-extension supervisors. No extension failure is allowed
 * to escape manager lifecycle methods or affect another host. */
export class ExtensionHostManager {
  private readonly hosts = new Map<string, ExtensionHost>();
  private readonly providerOwners = new Map<string, string>();
  private readonly agentProviderOwners = new Map<string, string>();
  private readonly providerVault: ExtensionProviderVault | undefined;
  constructor(private readonly options: ExtensionHostManagerOptions) { this.providerVault = options.vault === undefined ? undefined : new ExtensionProviderVault(options.vault); }

  statuses(): readonly ExtensionHostStatus[] { return Object.freeze([...this.hosts.values()].map((host) => host.status()).sort((a, b) => a.extensionId.localeCompare(b.extensionId))); }

  async start(descriptor: ExtensionLaunchDescriptor): Promise<ExtensionHostStatus> {
    let host = this.hosts.get(descriptor.extensionId);
    if (host === undefined) {
      host = new ExtensionHost(descriptor.extensionId, { ...this.options, dependencies: { call: (request) => this.callDependency(request) }, ...(this.providerVault === undefined ? {} : { providerVault: this.providerVault }) });
      this.hosts.set(descriptor.extensionId, host);
    }
    await host.start(descriptor);
    for (const provider of host.status().providers ?? []) {
      const owner = this.providerOwners.get(provider.providerId);
      if (owner !== undefined && owner !== descriptor.extensionId) { await host.stop(); throw new Error(`project environment provider already registered: ${provider.providerId}`); }
      this.providerOwners.set(provider.providerId, descriptor.extensionId);
    }
    for (const provider of host.status().agentProviders ?? []) {
      const owner = this.agentProviderOwners.get(provider.id);
      if (owner !== undefined && owner !== descriptor.extensionId) { await host.stop(); throw new Error(`agent provider already registered: ${provider.id}`); }
      this.agentProviderOwners.set(provider.id, descriptor.extensionId);
    }
    return host.status();
  }

  providerDefinitions() { return Object.freeze(this.statuses().flatMap((status) => status.state === "running" ? status.providers ?? [] : [])); }
  agentProviderContributions() { return Object.freeze(this.statuses().flatMap((status) => status.state === "running" ? status.agentProviders ?? [] : [])); }

  async admitAgentTerminal(admission: ExtensionAgentTerminalAdmission, signal?: AbortSignal): Promise<unknown> {
    const owner = this.agentProviderOwners.get(admission.context.providerId);
    if (owner === undefined) throw new Error("agent provider is unavailable");
    const host = this.hosts.get(owner);
    if (host === undefined) throw new Error("agent extension host does not exist");
    return host.admitAgentTerminal(admission, signal);
  }

  async cancelAgentTerminal(cancellation: ExtensionAgentTerminalCancellation): Promise<boolean> {
    for (const host of this.hosts.values()) if (await host.cancelAgentTerminal(cancellation)) return true;
    return false;
  }

  async drainAgentObservers(reason: "provider-disabled" | "extension-stopped" | "server-stopping"): Promise<void> {
    await Promise.all([...this.hosts.values()].map((host) => host.drainAgentObservers(reason)));
  }

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

  private callDependency(call: ExtensionDependencyCall) {
    const owner = this.providerOwners.get(call.request.providerId);
    if (owner === undefined) return Promise.reject(new Error("provider dependency target is unavailable"));
    if (owner === call.callerExtensionId) return Promise.reject(new Error("provider dependency target must be a declared external extension"));
    const caller = this.hosts.get(call.callerExtensionId); const target = this.hosts.get(owner);
    const callerDescriptor = caller?.launchDescriptor();
    if (callerDescriptor === undefined || target === undefined) return Promise.reject(new Error("provider dependency host is unavailable"));
    const dependency = callerDescriptor.extensionDependencies?.find((value) => value.extensionId === owner);
    if (dependency === undefined) return Promise.reject(new Error("provider dependency extension is not declared"));
    return target.invokeDependency(call.request.providerId, { operation: call.request.operation, payload: call.request.payload, caller: { extensionId: call.callerExtensionId, providerId: call.callerProviderId } }, call.context, call.signal);
  }

  async stop(extensionId: string): Promise<void> {
    await this.hosts.get(extensionId)?.stop();
    for (const [providerId, owner] of this.providerOwners) if (owner === extensionId) this.providerOwners.delete(providerId);
    for (const [providerId, owner] of this.agentProviderOwners) if (owner === extensionId) this.agentProviderOwners.delete(providerId);
  }

  async shutdown(): Promise<void> {
    await this.drainAgentObservers("server-stopping");
    const results = await Promise.allSettled([...this.hosts.values()].map((host) => host.stop()));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), "extension host shutdown failed");
  }
}
