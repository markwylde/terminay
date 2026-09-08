import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectEnvironmentRepository } from '../projectEnvironment/repository.js';
import type { ServerVaultComposition } from '../settings/vaultComposition.js';
import { DirectoryBuiltInExtensionArtifactSource } from './builtInArtifacts.js';
import type {
	ExtensionHostDiagnosticListener,
	ExtensionHostTransition,
} from './diagnostics.js';
import { ExtensionInstaller } from './installer.js';
import type {
	BuiltInExtensionArtifactSource,
	ExtensionRegistrySnapshot,
} from './installerTypes.js';
import { ExtensionHostManager } from './manager.js';
import { NpmCliRegistryClient } from './npmClient.js';
import type { ExtensionOperationOptions } from './operations.js';
import { ExtensionProfileService } from './profileService.js';
import type {
	ExtensionAgentBroker,
	ExtensionBroker,
	ExtensionHostStatus,
	ExtensionProfileBroker,
	ExtensionSecretAccessBroker,
} from './types.js';

export interface DefaultExtensionManagementOptions {
	readonly dataRoot: string;
	readonly authorityLabel: string;
	readonly broker?: ExtensionBroker;
	readonly childEntrypoint?: string;
	readonly secrets?: ExtensionSecretAccessBroker;
	readonly profiles?: ExtensionProfileBroker;
	readonly agents?: ExtensionAgentBroker;
	readonly vault?: ServerVaultComposition /** Host-owned immutable release resource directory. */;
	readonly builtInArtifactRoot?: string /** Test/composition seam for a host-owned verified inventory. Production uses builtInArtifactRoot. */;
	readonly builtIns?: BuiltInExtensionArtifactSource;
	/** Where host lifecycle records go. Absent means they are not recorded. */
	readonly onHostDiagnostic?: ExtensionHostDiagnosticListener;
	/** Injected only so supervisor tests need no wall-clock timers. */
	readonly schedule?: (
		callback: () => void | Promise<void>,
		milliseconds: number,
	) => ReturnType<typeof setTimeout>;
	readonly cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
	readonly now?: () => number;
}

/** Construct the identical selected-server extension authority for Desktop's
 * embedded server, standalone installations, and containers. */
export function createDefaultExtensionManagement(
	options: DefaultExtensionManagementOptions,
): ExtensionOperationOptions & {
	readonly installer: ExtensionInstaller;
	readonly hosts: ExtensionHostManager;
	readonly initialize: () => Promise<ExtensionRegistrySnapshot>;
	readonly reconcileBuiltIns: (
		signal?: AbortSignal,
	) => Promise<ExtensionRegistrySnapshot>;
	/** Cancels every pending automatic restart. Called on server shutdown. */
	readonly stopSupervision: () => void;
} {
	const broker: ExtensionBroker = options.broker ?? {
		request: async () => {
			throw new Error('extension broker capability is unavailable');
		},
	};
	const diagnostics = options.onHostDiagnostic;
	const now = options.now ?? Date.now;
	const schedule =
		options.schedule ??
		((callback, milliseconds) => setTimeout(callback, milliseconds));
	const cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
	/** Restarts pending per extension, so a supervisor never queues two. */
	const restarts = new Map<string, ReturnType<typeof setTimeout>>();
	let stopped = false;
	const recordSupervision = (
		extensionId: string,
		transition: ExtensionHostTransition,
		detail: { consecutiveFailures?: number; restartAt?: number } = {},
	): void => {
		try {
			diagnostics?.({ extensionId, transition, at: now(), ...detail });
		} catch {
			/* a diagnostic sink must never change extension lifecycle */
		}
	};
	const hosts = new ExtensionHostManager({
		broker,
		...(diagnostics === undefined ? {} : { onDiagnostic: diagnostics }),
		onStateChange: (status) => superviseRestart(status),
		...(options.childEntrypoint === undefined
			? {}
			: { childEntrypoint: options.childEntrypoint }),
		...(options.secrets === undefined ? {} : { secrets: options.secrets }),
		...(options.profiles === undefined ? {} : { profiles: options.profiles }),
		...(options.agents === undefined ? {} : { agents: options.agents }),
		...(options.vault === undefined ? {} : { vault: options.vault.vault }),
	});
	const npm = new NpmCliRegistryClient({
		workRoot: join(options.dataRoot, 'extensions', 'cache', 'npm'),
	});
	let activateReconciled:
		| ((
				before: ExtensionRegistrySnapshot,
				after: ExtensionRegistrySnapshot,
		  ) => Promise<void>)
		| undefined;
	const installer = new ExtensionInstaller({
		dataRoot: options.dataRoot,
		registryClient: npm,
		materializer: npm,
		...(options.builtIns === undefined
			? options.builtInArtifactRoot === undefined
				? {}
				: {
						builtIns: new DirectoryBuiltInExtensionArtifactSource(
							options.builtInArtifactRoot,
						),
					}
			: { builtIns: options.builtIns }),
		onBuiltInsReconciled: async (before, after) =>
			activateReconciled?.(before, after),
		probe: async ({ extensionId, packageRoot, entrypoint, manifest }) => {
			const root = join(options.dataRoot, 'extensions');
			const directories = {
				config: join(root, 'config', extensionId),
				data: join(root, 'data', extensionId),
				cache: join(root, 'cache', extensionId),
			};
			await Promise.all(
				Object.values(directories).map((directory) =>
					mkdir(directory, { recursive: true }),
				),
			);
			if (
				'registerManifest' in broker &&
				typeof broker.registerManifest === 'function'
			)
				broker.registerManifest(manifest);
			await hosts.start({
				extensionId,
				packageRoot,
				entrypoint,
				configDirectory: directories.config,
				dataDirectory: directories.data,
				cacheDirectory: directories.cache,
				permissions: manifest.permissions,
				agentProviders: manifest.contributes.agentProviders ?? [],
				projectEnvironmentProviders:
					manifest.contributes.projectEnvironments ?? [],
				extensionDependencies: manifest.extensionDependencies ?? [],
			});
			await hosts.stop(extensionId);
		},
	});
	const activate = async (extensionId: string): Promise<void> => {
		const descriptor = await installer.launchDescriptor(extensionId);
		const root = join(options.dataRoot, 'extensions');
		const directories = {
			config: join(root, 'config', extensionId),
			data: join(root, 'data', extensionId),
			cache: join(root, 'cache', extensionId),
		};
		await Promise.all(
			Object.values(directories).map((directory) =>
				mkdir(directory, { recursive: true }),
			),
		);
		if (
			'registerManifest' in broker &&
			typeof broker.registerManifest === 'function'
		)
			broker.registerManifest(descriptor.manifest);
		await hosts.stop(extensionId);
		await hosts.start({
			...descriptor,
			configDirectory: directories.config,
			dataDirectory: directories.data,
			cacheDirectory: directories.cache,
			permissions: descriptor.manifest.permissions,
			agentProviders: descriptor.agentProviders,
			projectEnvironmentProviders:
				descriptor.manifest.contributes.projectEnvironments ?? [],
			extensionDependencies: descriptor.manifest.extensionDependencies ?? [],
		});
	};
	const activateEnabled = async (): Promise<void> => {
		for (const extensionId of await installer.enabledExtensionIds()) {
			if (
				hosts.statuses().find((status) => status.extensionId === extensionId)
					?.state === 'running'
			)
				continue;
			try {
				await activate(extensionId);
			} catch (error) {
				await installer.setFailureState(
					extensionId,
					'failed',
					error instanceof Error
						? error.message
						: 'extension activation failed',
				);
			}
		}
	};
	activateReconciled = async (before, reconciled): Promise<void> => {
		for (const record of Object.values(reconciled.extensions)) {
			if (
				!shouldActivateAfterReconciliation(
					before.extensions[record.extensionId],
					record,
					hosts,
				)
			)
				continue;
			try {
				await activate(record.extensionId);
			} catch (error) {
				await installer.setFailureState(
					record.extensionId,
					'failed',
					error instanceof Error
						? error.message
						: 'extension activation failed',
				);
			}
		}
	};
	/**
	 * Bring a failed host back on its own.
	 *
	 * `ExtensionHost` already decides when a failure is worth retrying and how
	 * long to wait; without something acting on that decision an extension that
	 * dies mid-session stays dead until the application restarts, and its
	 * terminals silently lose agent observation. Restarting through `activate`
	 * rather than `host.start` is what re-publishes contributions, which is what
	 * lets an already-running CLI be observed again.
	 *
	 * Quarantine is the deliberate end of the line: it exists to stop a crash
	 * loop, so only an explicit restart clears it.
	 */
	const superviseRestart = (status: ExtensionHostStatus): void => {
		const extensionId = status.extensionId;
		if (status.state !== 'failed' || status.restartAt === undefined) {
			const pending = restarts.get(extensionId);
			if (pending !== undefined && status.state !== 'failed') {
				cancelSchedule(pending);
				restarts.delete(extensionId);
			}
			return;
		}
		if (stopped || restarts.has(extensionId)) return;
		const delay = Math.max(0, status.restartAt - now());
		restarts.set(
			extensionId,
			// The callback returns its work so an injected schedule can await the
			// restart; a real timer simply ignores the promise.
			schedule(async () => {
				restarts.delete(extensionId);
				if (stopped) return;
				const current = hosts
					.statuses()
					.find((candidate) => candidate.extensionId === extensionId);
				if (current?.state !== 'failed') return;
				recordSupervision(extensionId, 'restart-attempted', {
					consecutiveFailures: current.consecutiveCrashes,
				});
				try {
					await activate(extensionId);
				} catch (error) {
					// A restart that cannot even start is itself a failure the host
					// counts, so quarantine still bounds the loop.
					await installer
						.setFailureState(
							extensionId,
							'failed',
							error instanceof Error
								? error.message
								: 'extension restart failed',
						)
						.catch(() => undefined);
				}
			}, delay),
		);
	};

	/** Stop supervising, so no restart can fire after shutdown. */
	const stopSupervision = (): void => {
		stopped = true;
		for (const timer of restarts.values()) cancelSchedule(timer);
		restarts.clear();
	};

	/**
	 * The deliberate restart: it is the only thing that clears quarantine, and
	 * it resets the crash window with it.
	 */
	const restart = async (extensionId: string): Promise<void> => {
		const pending = restarts.get(extensionId);
		if (pending !== undefined) {
			cancelSchedule(pending);
			restarts.delete(extensionId);
		}
		await hosts.stop(extensionId).catch(() => undefined);
		hosts.clearQuarantine(extensionId);
		await activate(extensionId);
	};

	const reconcileBuiltIns = (
		signal?: AbortSignal,
	): Promise<ExtensionRegistrySnapshot> => installer.reconcileBuiltIns(signal);
	const initialize = async (): Promise<ExtensionRegistrySnapshot> => {
		await installer.initialize();
		await activateEnabled();
		return installer.snapshot();
	};
	return {
		installer,
		hosts,
		authorityLabel: options.authorityLabel,
		activate,
		activateEnabled,
		initialize,
		reconcileBuiltIns,
		restart,
		stopSupervision,
	};
}

/** A newly selected active slot, or an enabled slot without a running host,
 * must be activated before the management surface can call it installed. */
function shouldActivateAfterReconciliation(
	previous: import('./installerTypes.js').InstalledExtensionRecord | undefined,
	next: import('./installerTypes.js').InstalledExtensionRecord,
	hosts: ExtensionHostManager,
): boolean {
	if (
		!next.enabled ||
		next.activeSlotId === undefined ||
		next.state === 'failed' ||
		next.state === 'incompatible' ||
		next.state === 'quarantined'
	)
		return false;
	if (previous?.activeSlotId !== next.activeSlotId || previous.enabled !== true)
		return true;
	return (
		hosts.statuses().find((status) => status.extensionId === next.extensionId)
			?.state !== 'running'
	);
}

/** Production composition for ordinary public project-environment extensions.
 * Provider dependencies are authorized and routed by ExtensionHostManager;
 * this layer contains no SSH/Puzed identities or operation knowledge. */
export function createProductionExtensionManagement(
	options: Readonly<{
		dataRoot: string;
		authorityLabel: string;
		childEntrypoint?: string;
		vault: ServerVaultComposition;
		projectEnvironments: ProjectEnvironmentRepository;
		agents?: ExtensionAgentBroker;
		builtInArtifactRoot?: string;
		onHostDiagnostic?: ExtensionHostDiagnosticListener;
	}>,
) {
	let profileService: ExtensionProfileService | undefined;
	const profiles: ExtensionProfileBroker = {
		async get(extensionId, providerId, profileId, signal) {
			if (profileService === undefined)
				throw new Error('extension profile access is unavailable');
			return profileService.get(extensionId, providerId, profileId, signal);
		},
	};
	const management = createDefaultExtensionManagement({
		dataRoot: options.dataRoot,
		authorityLabel: options.authorityLabel,
		secrets: options.vault.extensionSecrets,
		profiles,
		vault: options.vault,
		...(options.childEntrypoint === undefined
			? {}
			: { childEntrypoint: options.childEntrypoint }),
		...(options.agents === undefined ? {} : { agents: options.agents }),
		...(options.builtInArtifactRoot === undefined
			? {}
			: { builtInArtifactRoot: options.builtInArtifactRoot }),
		...(options.onHostDiagnostic === undefined
			? {}
			: { onHostDiagnostic: options.onHostDiagnostic }),
	});
	profileService = new ExtensionProfileService(
		options.projectEnvironments,
		management.hosts,
		options.vault,
	);
	return Object.freeze({
		...management,
		profiles: profileService,
		vault: options.vault,
	});
}
