import type { ServerVaultService } from '../settings/vault.js';
import type { ExtensionHostDiagnosticListener } from './diagnostics.js';
import { ExtensionHost } from './host.js';
import type {
	ExtensionAgentBroker,
	ExtensionAgentTerminalAdmission,
	ExtensionAgentTerminalCancellation,
	ExtensionBroker,
	ExtensionHostLimits,
	ExtensionHostStatus,
	ExtensionInvocation,
	ExtensionLaunchDescriptor,
	ExtensionSecretAccessBroker,
} from './types.js';

export interface ExtensionHostManagerOptions {
	readonly broker: ExtensionBroker;
	readonly childEntrypoint?: string;
	readonly limits?: ExtensionHostLimits;
	readonly nodeExecutable?: string;
	readonly secrets?: ExtensionSecretAccessBroker;
	readonly agents?: ExtensionAgentBroker;
	readonly vault?: ServerVaultService;
	/** Passed to every host it creates; absent means nothing is recorded. */
	readonly onDiagnostic?: ExtensionHostDiagnosticListener;
	/** Observed after every host state transition, for restart supervision. */
	readonly onStateChange?: (status: ExtensionHostStatus) => void;
}

/** Owns independent per-extension supervisors. No extension failure is allowed
 * to escape manager lifecycle methods or affect another host. */
export class ExtensionHostManager {
	private readonly hosts = new Map<string, ExtensionHost>();
	private readonly agentProviderOwners = new Map<string, string>();
	private readonly publishedExtensions = new Set<string>();
	private readonly contributionListeners = new Set<
		() => void | Promise<void>
	>();
	private readonly starts = new Map<string, Promise<ExtensionHostStatus>>();
	private contributionMutation: Promise<void> = Promise.resolve();
	constructor(private readonly options: ExtensionHostManagerOptions) {}

	statuses(): readonly ExtensionHostStatus[] {
		return Object.freeze(
			[...this.hosts.values()]
				.map((host) => host.status())
				.sort((a, b) => a.extensionId.localeCompare(b.extensionId)),
		);
	}

	/** Host-owned notification for server runtimes that need to reconcile
	 * existing terminal bindings when a provider inventory changes. Callbacks
	 * are observational: they cannot delay, reject, or mutate publication. */
	onContributionsChanged(listener: () => void | Promise<void>): () => void {
		this.contributionListeners.add(listener);
		return () => this.contributionListeners.delete(listener);
	}

	async start(
		descriptor: ExtensionLaunchDescriptor,
	): Promise<ExtensionHostStatus> {
		const existing = this.starts.get(descriptor.extensionId);
		if (existing !== undefined) return existing;
		const start = this.startOne(descriptor);
		this.starts.set(descriptor.extensionId, start);
		try {
			return await start;
		} finally {
			if (this.starts.get(descriptor.extensionId) === start)
				this.starts.delete(descriptor.extensionId);
		}
	}

	private async startOne(
		descriptor: ExtensionLaunchDescriptor,
	): Promise<ExtensionHostStatus> {
		let host = this.hosts.get(descriptor.extensionId);
		if (host === undefined) {
			host = new ExtensionHost(descriptor.extensionId, { ...this.options });
			this.hosts.set(descriptor.extensionId, host);
		}
		await host.start(descriptor);
		try {
			return await this.mutateContributions(() => {
				const status = host.status();
				if (status.state !== 'running')
					throw new Error('extension host stopped before provider publication');
				this.assertContributionOwnership(status, descriptor.extensionId);
				for (const provider of status.agentProviders ?? [])
					this.agentProviderOwners.set(provider.id, descriptor.extensionId);
				this.publishedExtensions.add(descriptor.extensionId);
				this.notifyContributionListeners();
				return status;
			});
		} catch (error) {
			await host.stop();
			throw error;
		}
	}

	agentProviderContributions() {
		return Object.freeze(
			this.statuses().flatMap((status) =>
				status.state === 'running' &&
				this.publishedExtensions.has(status.extensionId)
					? (status.agentProviders ?? [])
					: [],
			),
		);
	}

	async admitAgentTerminal(
		admission: ExtensionAgentTerminalAdmission,
		signal?: AbortSignal,
	): Promise<unknown> {
		const owner = this.agentProviderOwners.get(admission.context.providerId);
		if (owner === undefined) throw new Error('agent provider is unavailable');
		const host = this.hosts.get(owner);
		if (host === undefined)
			throw new Error('agent extension host does not exist');
		return host.admitAgentTerminal(admission, signal);
	}

	async cancelAgentTerminal(
		cancellation: ExtensionAgentTerminalCancellation,
	): Promise<boolean> {
		for (const host of this.hosts.values())
			if (await host.cancelAgentTerminal(cancellation)) return true;
		return false;
	}

	async drainAgentObservers(
		reason: 'provider-disabled' | 'extension-stopped' | 'server-stopping',
	): Promise<void> {
		await Promise.all(
			[...this.hosts.values()].map((host) => host.drainAgentObservers(reason)),
		);
	}

	invoke(
		extensionId: string,
		invocation: ExtensionInvocation,
	): Promise<unknown> {
		const host = this.hosts.get(extensionId);
		if (host === undefined)
			return Promise.reject(new Error('extension host does not exist'));
		return host.invoke(invocation);
	}

	async stop(extensionId: string): Promise<void> {
		await this.hosts.get(extensionId)?.stop();
		await this.mutateContributions(() =>
			this.removeContributionOwnership(extensionId),
		);
	}

	/**
	 * Return a quarantined host to a startable state.
	 *
	 * Quarantine is deliberately sticky, so this exists only for the explicit
	 * restart a person asks for. An extension with no host yet has nothing to
	 * clear and is left alone.
	 */
	clearQuarantine(extensionId: string): void {
		this.hosts.get(extensionId)?.clearQuarantine();
	}

	async shutdown(): Promise<void> {
		await this.drainAgentObservers('server-stopping');
		const results = await Promise.allSettled(
			[...this.hosts.values()].map((host) => host.stop()),
		);
		await this.mutateContributions(() => {
			this.agentProviderOwners.clear();
			this.publishedExtensions.clear();
			this.notifyContributionListeners();
		});
		const failures = results.filter(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		);
		if (failures.length > 0)
			throw new AggregateError(
				failures.map((failure) => failure.reason),
				'extension host shutdown failed',
			);
	}

	private assertContributionOwnership(
		status: ExtensionHostStatus,
		extensionId: string,
	): void {
		for (const provider of status.agentProviders ?? []) {
			const owner = this.agentProviderOwners.get(provider.id);
			if (owner !== undefined && owner !== extensionId)
				throw new Error(`agent provider already registered: ${provider.id}`);
		}
	}

	private removeContributionOwnership(extensionId: string): void {
		const wasPublished = this.publishedExtensions.delete(extensionId);
		for (const [providerId, owner] of this.agentProviderOwners)
			if (owner === extensionId) this.agentProviderOwners.delete(providerId);
		if (wasPublished) this.notifyContributionListeners();
	}

	/** Contribution ownership changes only after the child has activated. This
	 * prevents observers from seeing a partial provider set while two extensions
	 * activate concurrently. */
	private mutateContributions<T>(work: () => T | Promise<T>): Promise<T> {
		const operation = this.contributionMutation.then(work, work);
		this.contributionMutation = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private notifyContributionListeners(): void {
		for (const listener of this.contributionListeners) {
			try {
				void Promise.resolve(listener()).catch(() => undefined);
			} catch {
				/* observer hooks cannot affect extension lifecycle */
			}
		}
	}
}
