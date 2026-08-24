import type { ProjectEnvironmentContribution } from "@terminay/extension-api";
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
  private readonly publishedExtensions = new Set<string>();
  private readonly contributionListeners = new Set<() => void | Promise<void>>();
  private readonly starts = new Map<string, Promise<ExtensionHostStatus>>();
  private contributionMutation: Promise<void> = Promise.resolve();
  private readonly providerVault: ExtensionProviderVault | undefined;
  constructor(private readonly options: ExtensionHostManagerOptions) { this.providerVault = options.vault === undefined ? undefined : new ExtensionProviderVault(options.vault); }

  statuses(): readonly ExtensionHostStatus[] { return Object.freeze([...this.hosts.values()].map((host) => host.status()).sort((a, b) => a.extensionId.localeCompare(b.extensionId))); }

  /** Host-owned notification for server runtimes that need to reconcile
   * existing terminal bindings when a provider inventory changes. Callbacks
   * are observational: they cannot delay, reject, or mutate publication. */
  onContributionsChanged(listener: () => void | Promise<void>): () => void {
    this.contributionListeners.add(listener);
    return () => this.contributionListeners.delete(listener);
  }

  async start(descriptor: ExtensionLaunchDescriptor): Promise<ExtensionHostStatus> {
    const existing = this.starts.get(descriptor.extensionId);
    if (existing !== undefined) return existing;
    const start = this.startOne(descriptor);
    this.starts.set(descriptor.extensionId, start);
    try { return await start; }
    finally { if (this.starts.get(descriptor.extensionId) === start) this.starts.delete(descriptor.extensionId); }
  }

  private async startOne(descriptor: ExtensionLaunchDescriptor): Promise<ExtensionHostStatus> {
    let host = this.hosts.get(descriptor.extensionId);
    if (host === undefined) {
      host = new ExtensionHost(descriptor.extensionId, { ...this.options, dependencies: { call: (request) => this.callDependency(request) }, ...(this.providerVault === undefined ? {} : { providerVault: this.providerVault }) });
      this.hosts.set(descriptor.extensionId, host);
    }
    await host.start(descriptor);
    try {
      return await this.mutateContributions(() => {
        const status = host.status();
        if (status.state !== "running") throw new Error("extension host stopped before provider publication");
        this.assertContributionOwnership(status, descriptor.extensionId);
        for (const provider of status.providers ?? []) this.providerOwners.set(provider.providerId, descriptor.extensionId);
        for (const provider of status.agentProviders ?? []) this.agentProviderOwners.set(provider.id, descriptor.extensionId);
        this.publishedExtensions.add(descriptor.extensionId);
        this.notifyContributionListeners();
        return status;
      });
    } catch (error) {
      await host.stop();
      throw error;
    }
  }

  providerDefinitions() { return Object.freeze(this.statuses().flatMap((status) => status.state === "running" && this.publishedExtensions.has(status.extensionId) ? status.providers ?? [] : [])); }
  /** Public-manifest contributions that have an active, matching provider
   * registration. Disabled, failed, and merely installed extensions are absent. */
  activatedProjectEnvironmentContributions(): readonly ProjectEnvironmentContribution[] {
    return Object.freeze([...this.hosts.values()]
      .filter((host) => this.publishedExtensions.has(host.extensionId))
      .flatMap((host) => host.activatedProjectEnvironmentContributions()));
  }
  agentProviderContributions() { return Object.freeze(this.statuses().flatMap((status) => status.state === "running" && this.publishedExtensions.has(status.extensionId) ? status.agentProviders ?? [] : [])); }

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
    await this.mutateContributions(() => this.removeContributionOwnership(extensionId));
  }

  async shutdown(): Promise<void> {
    await this.drainAgentObservers("server-stopping");
    const results = await Promise.allSettled([...this.hosts.values()].map((host) => host.stop()));
    await this.mutateContributions(() => {
      this.providerOwners.clear();
      this.agentProviderOwners.clear();
      this.publishedExtensions.clear();
      this.notifyContributionListeners();
    });
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), "extension host shutdown failed");
  }

  private assertContributionOwnership(status: ExtensionHostStatus, extensionId: string): void {
    for (const provider of status.providers ?? []) {
      const owner = this.providerOwners.get(provider.providerId);
      if (owner !== undefined && owner !== extensionId) throw new Error(`project environment provider already registered: ${provider.providerId}`);
    }
    for (const provider of status.agentProviders ?? []) {
      const owner = this.agentProviderOwners.get(provider.id);
      if (owner !== undefined && owner !== extensionId) throw new Error(`agent provider already registered: ${provider.id}`);
    }
  }

  private removeContributionOwnership(extensionId: string): void {
    const wasPublished = this.publishedExtensions.delete(extensionId);
    for (const [providerId, owner] of this.providerOwners) if (owner === extensionId) this.providerOwners.delete(providerId);
    for (const [providerId, owner] of this.agentProviderOwners) if (owner === extensionId) this.agentProviderOwners.delete(providerId);
    if (wasPublished) this.notifyContributionListeners();
  }

  /** Contribution ownership changes only after the child has activated. This
   * prevents observers from seeing a partial provider set while two extensions
   * activate concurrently. */
  private mutateContributions<T>(work: () => T | Promise<T>): Promise<T> {
    const operation = this.contributionMutation.then(work, work);
    this.contributionMutation = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private notifyContributionListeners(): void {
    for (const listener of this.contributionListeners) {
      try { void Promise.resolve(listener()).catch(() => undefined); }
      catch { /* observer hooks cannot affect extension lifecycle */ }
    }
  }
}
