import type { ProtocolId } from '@terminay/protocol';
import { THIS_SERVER_ENVIRONMENT_ID, type WorkspaceState } from '../workspace.js';
import type { PtyFactory, PtyProcess, PtySpawnOptions } from '../terminalService/types.js';
import type { ProjectEnvironmentRegistry } from './registry.js';
import { ProjectEnvironmentCapabilityError } from './registry.js';
import type {
	ProjectEnvironmentCapability,
	ProjectEnvironmentRecord,
	ProjectEnvironmentState,
	ProjectEnvironmentStatus,
} from './types.js';

export type ProjectEnvironmentRouteErrorCode =
	| 'project-unavailable'
	| 'environment-unavailable'
	| 'environment-revision-mismatch'
	| 'provider-unavailable'
	| 'operation-cancelled'
	| 'operation-timeout'
	| 'provider-operation-failed';

/** A safe, transport-independent failure. Provider exceptions are retained as
 * non-enumerable causes for server diagnostics and never become protocol data. */
export class ProjectEnvironmentRouteError extends Error {
	readonly code: ProjectEnvironmentRouteErrorCode;
	readonly retryable: boolean;
	readonly environmentStatus?: ProjectEnvironmentStatus;

	constructor(
		code: ProjectEnvironmentRouteErrorCode,
		message: string,
		options: {
			readonly retryable?: boolean;
			readonly environmentStatus?: ProjectEnvironmentStatus;
			readonly cause?: unknown;
		} = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'ProjectEnvironmentRouteError';
		this.code = code;
		this.retryable = options.retryable === true;
		if (options.environmentStatus !== undefined) this.environmentStatus = options.environmentStatus;
	}
}

export interface ProjectEnvironmentBinding {
	readonly serverId: ProtocolId;
	readonly projectId: ProtocolId;
	readonly projectEnvironmentId: ProtocolId;
	readonly environmentRevision: number;
}

export interface ProjectEnvironmentRouterOptions {
	readonly serverId: ProtocolId;
	readonly workspaceSnapshot: () => WorkspaceState;
	readonly environmentSnapshot: () => ProjectEnvironmentState;
	readonly registry: ProjectEnvironmentRegistry;
	readonly defaultTimeoutMs?: number;
	readonly now?: () => number;
}

export interface ProjectEnvironmentInvocationOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

/**
 * The single server-side routing authority for privileged project operations.
 * It derives the environment exclusively from canonical server-owned state.
 * In particular, neither provider ids nor a "local" fallback are accepted
 * from callers.
 */
export class ProjectEnvironmentRouter {
	private readonly now: () => number;
	private readonly defaultTimeoutMs: number;

	constructor(private readonly options: ProjectEnvironmentRouterOptions) {
		if (options.serverId.length === 0) throw new TypeError('project environment router server id is required');
		this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
		if (!Number.isSafeInteger(this.defaultTimeoutMs) || this.defaultTimeoutMs <= 0)
			throw new RangeError('project environment router timeout must be positive');
		this.now = options.now ?? (() => Date.now());
	}

	/** Capture this when creating a terminal/file draft/long-lived operation.
	 * Later calls use the immutable binding instead of silently following a
	 * changed project to another machine. */
	bindProject(projectId: ProtocolId): ProjectEnvironmentBinding {
		const { project } = this.project(projectId);
		return Object.freeze({
			serverId: this.options.serverId,
			projectId,
			projectEnvironmentId: project.projectEnvironmentId,
			environmentRevision: project.environmentRevision,
		});
	}

	async invoke<T>(
		projectId: ProtocolId,
		capability: ProjectEnvironmentCapability,
		operation: string,
		input: unknown,
		options: ProjectEnvironmentInvocationOptions = {},
	): Promise<T> {
		return this.invokeBound(this.bindProject(projectId), capability, operation, input, options);
	}

	/** Route a production entrypoint while adapting the existing This server
	 * implementation in place. The local callback is reachable only after the
	 * canonical binding resolves to the reserved built-in environment. */
	async route<T>(
		projectId: ProtocolId,
		capability: ProjectEnvironmentCapability,
		operation: string,
		input: unknown,
		thisServer: () => Promise<T> | T,
		options: ProjectEnvironmentInvocationOptions = {},
	): Promise<T> {
		const binding = this.bindProject(projectId);
		if (binding.projectEnvironmentId === THIS_SERVER_ENVIRONMENT_ID) {
			const environment = this.environment(binding);
			if (!environment.availableCapabilities.includes(capability)) throw new ProjectEnvironmentCapabilityError(capability);
			return thisServer();
		}
		return this.invokeBound(binding, capability, operation, input, options);
	}

	async invokeBound<T>(
		binding: ProjectEnvironmentBinding,
		capability: ProjectEnvironmentCapability,
		operation: string,
		input: unknown,
		options: ProjectEnvironmentInvocationOptions = {},
	): Promise<T> {
		if (binding.serverId !== this.options.serverId)
			throw new ProjectEnvironmentRouteError('project-unavailable', 'Project belongs to another Terminay Server.');
		if (operation.length === 0 || operation.length > 256 || operation.includes('\0'))
			throw new TypeError('project environment operation is invalid');
		const environment = this.environment(binding);
		const runtime = this.runtime(environment, capability);
		const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('project environment operation timeout must be positive');
		const deadline = this.now() + timeoutMs;
		const cancellation = boundedSignal(options.signal, timeoutMs);
		try {
			return await invokeWithCancellation(
				Promise.resolve(runtime.invoke(capability, operation, input, {
					...binding,
					deadline,
					signal: cancellation.signal,
				})),
				cancellation.signal,
			) as T;
		} catch (error) {
			if (error instanceof ProjectEnvironmentCapabilityError || error instanceof ProjectEnvironmentRouteError) throw error;
			if (cancellation.signal.aborted) {
				const external = options.signal?.aborted === true;
				throw new ProjectEnvironmentRouteError(
					external ? 'operation-cancelled' : 'operation-timeout',
					external ? 'Project environment operation was cancelled.' : 'Project environment operation timed out.',
					{ retryable: !external, cause: error },
				);
			}
			throw new ProjectEnvironmentRouteError(
				'provider-operation-failed',
				'Project environment provider operation failed.',
				{ retryable: true, cause: error },
			);
		} finally {
			cancellation.dispose();
		}
	}

	private project(projectId: ProtocolId) {
		const workspace = this.options.workspaceSnapshot();
		if (workspace.serverId !== this.options.serverId)
			throw new ProjectEnvironmentRouteError('project-unavailable', 'Workspace belongs to another Terminay Server.');
		const project = workspace.projects[projectId];
		if (project === undefined)
			throw new ProjectEnvironmentRouteError('project-unavailable', 'Project is unavailable.');
		return { workspace, project };
	}

	private environment(binding: ProjectEnvironmentBinding): ProjectEnvironmentRecord {
		const state = this.options.environmentSnapshot();
		if (state.serverId !== this.options.serverId)
			throw new ProjectEnvironmentRouteError('environment-unavailable', 'Environment registry belongs to another Terminay Server.');
		const environment = state.environments[binding.projectEnvironmentId];
		if (environment === undefined)
			throw new ProjectEnvironmentRouteError('environment-unavailable', 'Project environment is unavailable.');
		if (environment.pinnedRevision !== binding.environmentRevision)
			throw new ProjectEnvironmentRouteError('environment-revision-mismatch', 'Project environment configuration changed; reconnect explicitly.');
		if (environment.archived || environment.status !== 'ready')
			throw new ProjectEnvironmentRouteError('environment-unavailable', environment.failure?.message ?? `Project environment is ${environment.status}.`, {
				retryable: environment.failure?.retryable ?? ['connecting', 'reconnecting', 'provisioning', 'starting', 'stopping', 'offline', 'unreachable'].includes(environment.status),
				environmentStatus: environment.status,
			});
		return environment;
	}

	private runtime(environment: ProjectEnvironmentRecord, capability: ProjectEnvironmentCapability) {
		try {
			return this.options.registry.resolve(environment, capability);
		} catch (error) {
			if (error instanceof ProjectEnvironmentCapabilityError) throw error;
			throw new ProjectEnvironmentRouteError('provider-unavailable', 'Project environment provider is unavailable.', { retryable: true, cause: error });
		}
	}
}

/** Narrow service facade used by terminal, filesystem, Git, and observation
 * composition without duplicating environment-selection logic. */
export class EnvironmentRoutedProjectService {
	constructor(
		private readonly router: ProjectEnvironmentRouter,
		readonly capability: ProjectEnvironmentCapability,
	) {}

	bind(projectId: ProtocolId): ProjectEnvironmentBinding { return this.router.bindProject(projectId); }
	invoke<T>(projectId: ProtocolId, operation: string, input: unknown, options?: ProjectEnvironmentInvocationOptions): Promise<T> {
		return this.router.invoke(projectId, this.capability, operation, input, options);
	}
	invokeBound<T>(binding: ProjectEnvironmentBinding, operation: string, input: unknown, options?: ProjectEnvironmentInvocationOptions): Promise<T> {
		return this.router.invokeBound(binding, this.capability, operation, input, options);
	}
}

export interface EnvironmentRoutedProjectServices {
	readonly terminal: EnvironmentRoutedProjectService;
	readonly filesystem: EnvironmentRoutedProjectService;
	readonly filesystemObservation: EnvironmentRoutedProjectService;
	readonly git: EnvironmentRoutedProjectService;
	readonly processObservation: EnvironmentRoutedProjectService;
	readonly agentJournal: EnvironmentRoutedProjectService;
	readonly shellDiscovery: EnvironmentRoutedProjectService;
	readonly infrastructure: EnvironmentRoutedProjectService;
}

/** One shared router fans out to every privileged project service. Optional
 * services are still present as facades so an unsupported capability produces
 * the same explicit typed failure instead of encouraging a host-local path. */
export function createEnvironmentRoutedProjectServices(router: ProjectEnvironmentRouter): EnvironmentRoutedProjectServices {
	return Object.freeze({
		terminal: new EnvironmentRoutedProjectService(router, 'terminal'),
		filesystem: new EnvironmentRoutedProjectService(router, 'filesystem'),
		filesystemObservation: new EnvironmentRoutedProjectService(router, 'filesystem-observation'),
		git: new EnvironmentRoutedProjectService(router, 'git'),
		processObservation: new EnvironmentRoutedProjectService(router, 'process-observation'),
		agentJournal: new EnvironmentRoutedProjectService(router, 'agent-journal'),
		shellDiscovery: new EnvironmentRoutedProjectService(router, 'shell-discovery'),
		infrastructure: new EnvironmentRoutedProjectService(router, 'infrastructure'),
	});
}

/** Environment passed to a remote shell is allowlisted by its provider. This
 * helper provides the mandatory first fence: server-control/provider
 * variables can never cross merely because the Terminay Server inherited
 * them. TERM/COLORTERM should be added afterwards by the remote provider. */
export function filterRemoteTerminalEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
	const filtered: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(environment)) {
		const upper = name.toUpperCase();
		if (
			upper.startsWith('TERMINAY_') ||
			upper === 'HOME' ||
			upper === 'PATH' ||
			upper === 'PWD' ||
			upper === 'OLDPWD' ||
			upper === 'SHELL' ||
			upper === 'USER' ||
			upper === 'LOGNAME' ||
			upper === 'TMPDIR' ||
			upper === 'TMP' ||
			upper === 'TEMP' ||
			upper === 'NODE_OPTIONS' ||
			upper === 'SSH_AUTH_SOCK' ||
			upper === 'GIT_ASKPASS' ||
			upper === 'ELECTRON_RUN_AS_NODE'
		) continue;
		filtered[name] = value;
	}
	return Object.freeze(filtered);
}

/** Route PTY creation while TerminalService remains the canonical stream,
 * replay, recording, attachment and lifecycle authority. */
export function createEnvironmentRoutedPtyFactory(router: ProjectEnvironmentRouter, thisServerFactory: PtyFactory): PtyFactory {
	return {
		spawn: async (options: PtySpawnOptions): Promise<PtyProcess> => {
			const projectId = options.projectId;
			if (projectId === undefined) return await spawnPty(thisServerFactory, options);
			const { projectId: _projectId, projectEnvironmentId: _environmentId, environmentRevision: _revision, ...providerOptions } = options;
			void _projectId; void _environmentId; void _revision;
			return router.route(
				projectId,
				'terminal',
				'spawn',
				{ ...providerOptions, env: filterRemoteTerminalEnvironment(providerOptions.env ?? {}) },
				async () => await spawnPty(thisServerFactory, options),
			) as Promise<PtyProcess>;
		},
	};
}

function spawnPty(factory: PtyFactory, options: PtySpawnOptions): PromiseLike<PtyProcess> | PtyProcess {
	return typeof factory === 'function' ? factory(options) : factory.spawn(options);
}

function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number): { readonly signal: AbortSignal; readonly dispose: () => void } {
	const controller = new AbortController();
	const abort = () => controller.abort(parent?.reason);
	if (parent?.aborted === true) abort();
	else parent?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(() => controller.abort(new Error('project environment operation timed out')), timeoutMs);
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			parent?.removeEventListener('abort', abort);
		},
	};
}

function invokeWithCancellation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener('abort', aborted, { once: true });
		operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
	});
}
