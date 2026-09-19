import type {
	AgentSessionSourceContribution,
	LanguageServerContribution,
	McpInstallTargetContribution,
	McpServerCommand,
} from '@terminay/extension-api';
import type { ServerVaultService } from '../settings/vault.js';
import type { ExtensionHostDiagnosticListener } from './diagnostics.js';
import { ExtensionHost, type ExtensionLanguageInvocation } from './host.js';
import type {
	ExtensionLanguageDiagnosticsNotification,
	ExtensionLanguageSessionExit,
} from './languageProtocol.js';
import type {
	ExtensionAgentBroker,
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

/**
 * One contributed language server, and the extension that owns it.
 *
 * `languageServerId` is namespaced by the owning extension so two extensions
 * can each contribute a `typescript` server without colliding in a session key
 * or in a client-visible capability answer.
 */
export interface LanguageServerProvider {
	readonly extensionId: string;
	readonly languageServerId: string;
	readonly contribution: LanguageServerContribution;
}

/** One session source a running extension registered. */
export interface SessionSourceProvider {
	readonly extensionId: string;
	readonly contribution: AgentSessionSourceContribution;
}

/** One MCP install target a running extension registered. */
export interface McpInstallTargetProvider {
	readonly extensionId: string;
	readonly contribution: McpInstallTargetContribution;
}

export type ExtensionLanguageDiagnosticsListener = (
	notification: ExtensionLanguageDiagnosticsNotification & {
		readonly extensionId: string;
	},
) => void;

export type ExtensionLanguageSessionExitListener = (
	exit: ExtensionLanguageSessionExit & { readonly extensionId: string },
) => void;

/** Owns independent per-extension supervisors. No extension failure is allowed
 * to escape manager lifecycle methods or affect another host. */
export class ExtensionHostManager {
	private readonly hosts = new Map<string, ExtensionHost>();
	/** Source and target id → owning extension. */
	private readonly contributionOwners = new Map<string, string>();
	private readonly publishedExtensions = new Set<string>();
	private readonly contributionListeners = new Set<
		() => void | Promise<void>
	>();
	private readonly starts = new Map<string, Promise<ExtensionHostStatus>>();
	private readonly languageDiagnosticsListeners =
		new Set<ExtensionLanguageDiagnosticsListener>();
	private readonly languageSessionExitListeners =
		new Set<ExtensionLanguageSessionExitListener>();
	private readonly hostStateListeners = new Set<
		(status: ExtensionHostStatus) => void
	>();
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
			host = new ExtensionHost(descriptor.extensionId, {
				...this.options,
				onStateChange: (status) => {
					for (const listener of this.hostStateListeners) {
						try {
							listener(status);
						} catch {
							/* observers cannot change a lifecycle transition */
						}
					}
					this.options.onStateChange?.(status);
				},
				onLanguageDiagnostics: (notification) => {
					for (const listener of this.languageDiagnosticsListeners)
						listener(notification);
				},
				onLanguageSessionExit: (exit) => {
					for (const listener of this.languageSessionExitListeners)
						listener(exit);
				},
			});
			this.hosts.set(descriptor.extensionId, host);
		}
		await host.start(descriptor);
		try {
			return await this.mutateContributions(() => {
				const status = host.status();
				if (status.state !== 'running')
					throw new Error('extension host stopped before provider publication');
				this.assertContributionOwnership(status, descriptor.extensionId);
				for (const contribution of [
					...(status.agentSessionSources ?? []),
					...(status.mcpInstallTargets ?? []),
				])
					this.contributionOwners.set(contribution.id, descriptor.extensionId);
				this.publishedExtensions.add(descriptor.extensionId);
				this.notifyContributionListeners();
				return status;
			});
		} catch (error) {
			// A host that crashed between start and publication has already
			// recorded its failure and scheduled its restart. Stopping it would
			// turn that failed state into a deliberate stop, which cancels the
			// pending restart and leaves the extension dead until someone asks.
			// Only a host that is still up needs stopping here, which is the
			// contribution ownership conflict.
			const state = host.status().state;
			if (state !== 'failed' && state !== 'quarantined') await host.stop();
			throw error;
		}
	}

	/** Every session source registered by a running, published extension. */
	sessionSourceContributions(): readonly SessionSourceProvider[] {
		return Object.freeze(
			this.statuses().flatMap((status) =>
				status.state === 'running' &&
				this.publishedExtensions.has(status.extensionId)
					? (status.agentSessionSources ?? []).map((contribution) =>
							Object.freeze({ extensionId: status.extensionId, contribution }),
						)
					: [],
			),
		);
	}

	/** Every MCP install target registered by a running, published extension,
	 * in declaration order. */
	mcpInstallTargetContributions(): readonly McpInstallTargetProvider[] {
		return Object.freeze(
			this.statuses().flatMap((status) =>
				status.state === 'running' &&
				this.publishedExtensions.has(status.extensionId)
					? (status.mcpInstallTargets ?? []).map((contribution) =>
							Object.freeze({ extensionId: status.extensionId, contribution }),
						)
					: [],
			),
		);
	}

	async startSessionSource(
		sourceId: string,
		enabledHarnesses: readonly string[],
	): Promise<void> {
		return this.ownerHost(sourceId).startSessionSource(
			sourceId,
			enabledHarnesses,
		);
	}

	async stopSessionSource(sourceId: string): Promise<void> {
		const owner = this.contributionOwners.get(sourceId);
		if (owner === undefined) return;
		await this.hosts.get(owner)?.stopSessionSource(sourceId);
	}

	async setSessionSourceHarnesses(
		sourceId: string,
		enabledHarnesses: readonly string[],
	): Promise<void> {
		return this.ownerHost(sourceId).setSessionSourceHarnesses(
			sourceId,
			enabledHarnesses,
		);
	}

	async invokeMcpTarget(
		targetId: string,
		operation: 'status' | 'install' | 'uninstall',
		server: McpServerCommand,
		signal?: AbortSignal,
	): Promise<unknown> {
		return this.ownerHost(targetId).invokeMcpTarget(
			targetId,
			operation,
			server,
			signal,
		);
	}

	private ownerHost(contributionId: string): ExtensionHost {
		const owner = this.contributionOwners.get(contributionId);
		const host = owner === undefined ? undefined : this.hosts.get(owner);
		if (host === undefined)
			throw Object.assign(new Error('extension contribution is unavailable'), {
				code: 'unavailable',
				retryable: true,
			});
		return host;
	}

	/** Every language server contributed by a running, published extension. */
	languageServerContributions(): readonly LanguageServerProvider[] {
		return Object.freeze(
			this.statuses().flatMap((status) =>
				status.state === 'running' &&
				this.publishedExtensions.has(status.extensionId)
					? (status.languageServers ?? []).map((contribution) =>
							Object.freeze({
								extensionId: status.extensionId,
								languageServerId: `${status.extensionId}:${contribution.id}`,
								contribution,
							}),
						)
					: [],
			),
		);
	}

	/**
	 * The language servers that serve a file extension or a language id.
	 *
	 * A selector beginning with a dot is a file extension; anything else is
	 * matched against language ids first and then against the same extension
	 * list, so a caller with only `ts` in hand does not have to know which.
	 */
	languageServersFor(selector: string): readonly LanguageServerProvider[] {
		if (typeof selector !== 'string' || selector.length === 0)
			return Object.freeze([]);
		const value = selector.toLowerCase();
		const extension = value.startsWith('.') ? value : `.${value}`;
		return Object.freeze(
			this.languageServerContributions().filter(
				(provider) =>
					provider.contribution.fileExtensions?.some(
						(candidate) => candidate.toLowerCase() === extension,
					) === true ||
					(!value.startsWith('.') &&
						provider.contribution.languageIds?.some(
							(candidate) => candidate.toLowerCase() === value,
						) === true),
			),
		);
	}

	invokeLanguage(
		extensionId: string,
		invocation: ExtensionLanguageInvocation,
	): Promise<unknown> {
		const host = this.hosts.get(extensionId);
		if (host === undefined)
			return Promise.reject(
				Object.assign(new Error('extension host does not exist'), {
					code: 'unavailable',
					retryable: true,
				}),
			);
		return host.invokeLanguage(invocation);
	}

	onLanguageDiagnostics(
		listener: ExtensionLanguageDiagnosticsListener,
	): () => void {
		this.languageDiagnosticsListeners.add(listener);
		return () => this.languageDiagnosticsListeners.delete(listener);
	}

	onLanguageSessionExit(
		listener: ExtensionLanguageSessionExitListener,
	): () => void {
		this.languageSessionExitListeners.add(listener);
		return () => this.languageSessionExitListeners.delete(listener);
	}

	/** Observes every supervised host transition, for consumers that must end
	 * their own work when an extension stops, fails, or is quarantined. */
	onHostStateChanged(listener: (status: ExtensionHostStatus) => void): () => void {
		this.hostStateListeners.add(listener);
		return () => this.hostStateListeners.delete(listener);
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
		const results = await Promise.allSettled(
			[...this.hosts.values()].map((host) => host.stop()),
		);
		await this.mutateContributions(() => {
			this.contributionOwners.clear();
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
		for (const contribution of [
			...(status.agentSessionSources ?? []),
			...(status.mcpInstallTargets ?? []),
		]) {
			const owner = this.contributionOwners.get(contribution.id);
			if (owner !== undefined && owner !== extensionId)
				throw new Error(
					`extension contribution already registered: ${contribution.id}`,
				);
		}
	}

	private removeContributionOwnership(extensionId: string): void {
		const wasPublished = this.publishedExtensions.delete(extensionId);
		for (const [contributionId, owner] of this.contributionOwners)
			if (owner === extensionId) this.contributionOwners.delete(contributionId);
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
