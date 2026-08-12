import type { ExtensionBroker, ExtensionHostLimits, ExtensionHostStatus, ExtensionInvocation, ExtensionLaunchDescriptor } from "./types.js";
import { ExtensionHost } from "./host.js";

export interface ExtensionHostManagerOptions {
  readonly broker: ExtensionBroker;
  readonly limits?: ExtensionHostLimits;
  readonly nodeExecutable?: string;
}

/** Owns independent per-extension supervisors. No extension failure is allowed
 * to escape manager lifecycle methods or affect another host. */
export class ExtensionHostManager {
  private readonly hosts = new Map<string, ExtensionHost>();
  constructor(private readonly options: ExtensionHostManagerOptions) {}

  statuses(): readonly ExtensionHostStatus[] { return Object.freeze([...this.hosts.values()].map((host) => host.status()).sort((a, b) => a.extensionId.localeCompare(b.extensionId))); }

  async start(descriptor: ExtensionLaunchDescriptor): Promise<ExtensionHostStatus> {
    let host = this.hosts.get(descriptor.extensionId);
    if (host === undefined) {
      host = new ExtensionHost(descriptor.extensionId, this.options);
      this.hosts.set(descriptor.extensionId, host);
    }
    await host.start(descriptor);
    return host.status();
  }

  invoke(extensionId: string, invocation: ExtensionInvocation): Promise<unknown> {
    const host = this.hosts.get(extensionId);
    if (host === undefined) return Promise.reject(new Error("extension host does not exist"));
    return host.invoke(invocation);
  }

  async stop(extensionId: string): Promise<void> { await this.hosts.get(extensionId)?.stop(); }

  async shutdown(): Promise<void> {
    const results = await Promise.allSettled([...this.hosts.values()].map((host) => host.stop()));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), "extension host shutdown failed");
  }
}

