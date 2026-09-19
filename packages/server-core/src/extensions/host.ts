import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
	type AgentSessionSourceContribution,
	EXTENSION_API_VERSION,
	EXTENSION_LIMITS,
	isNamespacedId,
	type LanguageServerContribution,
	type McpInstallTargetContribution,
	type McpServerCommand,
	validateMcpInstallTargetActionResult,
	validateMcpInstallTargetStatus,
	validateMcpServerCommand,
} from '@terminay/extension-api';
import { validateExtensionLaunchDescriptor } from './descriptor.js';
import {
	type ExtensionErrorDetail,
	extensionErrorDetail,
	type ExtensionHostDiagnostic,
	type ExtensionHostDiagnosticListener,
	type ExtensionHostTransition,
} from './diagnostics.js';
import {
	type ExtensionLanguageDiagnosticsNotification,
	type ExtensionLanguageMethod,
	type ExtensionLanguageSessionExit,
	parseExtensionLanguageDiagnostics,
	parseExtensionLanguageSessionExit,
} from './languageProtocol.js';
import {
	type ChildFrame,
	EXTENSION_HOST_PROTOCOL_VERSION,
	type ExtensionFatalErrorReport,
	frameByteLength,
	type HostFrame,
	isChildFrame,
	isExtensionFatalErrorReport,
} from './protocol.js';
import type {
	ExtensionAgentBroker,
	ExtensionBroker,
	ExtensionHostLimits,
	ExtensionHostStatus,
	ExtensionInvocation,
	ExtensionLaunchDescriptor,
	ExtensionSecretAccessBroker,
} from './types.js';

interface PendingCall {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
	readonly abort?: () => void;
}

export interface ExtensionHostOptions {
	readonly broker: ExtensionBroker;
	readonly limits?: ExtensionHostLimits;
	readonly nodeExecutable?: string;
	readonly childEntrypoint?: string;
	readonly now?: () => number;
	readonly secrets?: ExtensionSecretAccessBroker;
	readonly agents?: ExtensionAgentBroker;
	/** Where lifecycle records go. Absent means they are not recorded. */
	readonly onDiagnostic?: ExtensionHostDiagnosticListener;
	/** Observed after every state transition, so a supervisor can act on a
	 * failure without polling. Observers cannot change the transition. */
	readonly onStateChange?: (status: ExtensionHostStatus) => void;
	/** Translated `publishDiagnostics` from one of this extension's language
	 * sessions. Core fans them out onto the workspace journal. */
	readonly onLanguageDiagnostics?: (
		notification: ExtensionLanguageDiagnosticsNotification & {
			readonly extensionId: string;
		},
	) => void;
	/** One language session ending, reported exactly once by the child. */
	readonly onLanguageSessionExit?: (
		exit: ExtensionLanguageSessionExit & { readonly extensionId: string },
	) => void;
}

/** One private language invocation on this extension's child. */
export interface ExtensionLanguageInvocation {
	readonly method: ExtensionLanguageMethod;
	readonly input: Readonly<Record<string, unknown>>;
	readonly deadlineMs?: number;
	readonly signal?: AbortSignal;
}

const DEFAULTS = Object.freeze({
	maxMessageBytes: 256 * 1024,
	maxConcurrentInvocations: 16,
	startupTimeoutMs: 15_000,
	invocationTimeoutMs: 30_000,
	shutdownTimeoutMs: 5_000,
	crashWindowMs: 60_000,
	maxCrashesInWindow: 5,
	initialBackoffMs: 250,
	maxBackoffMs: 30_000,
});

const INHERITED_CHILD_ENV = Object.freeze([
	'PATH',
	'HOME',
	'USER',
	'LOGNAME',
	'TMPDIR',
	'TMP',
	'TEMP',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TZ',
]);
const UNIX_PATH = '/usr/sbin:/usr/bin:/bin:/sbin';

/** Bounded host environment for an extension child. npm's sterile env stays
 * on the installer. A session source may name further variables, such as a
 * harness's home-directory override; each is passed only when it is set. */
export function extensionChildEnvironment(
	source: NodeJS.ProcessEnv = process.env,
	declared: readonly string[] = [],
): NodeJS.ProcessEnv {
	// Electron augments ProcessEnv with application variables that are required
	// in its own process but deliberately absent from an extension child.
	const env = {} as NodeJS.ProcessEnv;
	for (const key of [...INHERITED_CHILD_ENV, ...declared]) {
		const value = source[key];
		if (typeof value === 'string' && value.length > 0) env[key] = value;
	}
	env.PATH = completeChildPath(env.PATH);
	env.ELECTRON_RUN_AS_NODE = '1';
	env.NODE_ENV = 'production';
	env.TERMINAY_EXTENSION_HOST = '1';
	return env;
}

function completeChildPath(path: string | undefined): string {
	return [
		...new Set(
			[...(path?.split(':') ?? []), ...UNIX_PATH.split(':')].filter(
				(part) => part.length > 0,
			),
		),
	].join(':');
}

/** Supervises exactly one extension process. The process boundary is crash
 * isolation, not an OS security sandbox: installed extensions remain trusted
 * code running as the Terminay Server account. */
export class ExtensionHost {
	private child: ChildProcess | undefined;
	private descriptor: ExtensionLaunchDescriptor | undefined;
	private state: ExtensionHostStatus;
	private readonly pending = new Map<string, PendingCall>();
	private readonly activeBrokerCalls = new Map<string, AbortController>();
	private readonly crashTimes: number[] = [];
	private sequence = 0;
	private stopping = false;
	private agentSessionSources: readonly AgentSessionSourceContribution[] =
		Object.freeze([]);
	private mcpInstallTargets: readonly McpInstallTargetContribution[] =
		Object.freeze([]);
	/** Sources the host started and has not yet seen stop. */
	private readonly runningSources = new Set<string>();
	private languageServers: readonly LanguageServerContribution[] = Object.freeze(
		[],
	);
	private agentPublicationsInFlight = 0;
	/** The child's account of the error that is ending it, if it sent one. */
	private fatalReport: ExtensionFatalErrorReport | undefined;
	/** Whether this incarnation's death has already been counted as a crash. */
	private deathCounted = false;
	/** Whether an exit status has already been observed for this incarnation. */
	private exitRecorded = false;
	/** Writes the operating system refused after the channel accepted them. */
	private failedWrites = 0;
	private readonly limits: Required<ExtensionHostLimits>;
	private readonly now: () => number;

	constructor(
		readonly extensionId: string,
		private readonly options: ExtensionHostOptions,
	) {
		this.limits = { ...DEFAULTS, ...options.limits };
		this.now = options.now ?? Date.now;
		this.state = { extensionId, state: 'stopped', consecutiveCrashes: 0 };
	}

	status(): ExtensionHostStatus {
		return Object.freeze({
			...this.state,
			agentSessionSources: this.agentSessionSources,
			mcpInstallTargets: this.mcpInstallTargets,
			languageServers: this.languageServers,
		});
	}
	launchDescriptor(): ExtensionLaunchDescriptor | undefined {
		return this.descriptor;
	}

	async start(descriptor: ExtensionLaunchDescriptor): Promise<void> {
		if (descriptor.extensionId !== this.extensionId)
			throw new TypeError('extension descriptor identity mismatch');
		if (this.state.state === 'quarantined')
			throw new Error('extension is quarantined');
		if (this.child !== undefined) return;
		const restartAt = this.state.restartAt;
		if (restartAt !== undefined && restartAt > this.now())
			throw new Error('extension restart backoff is active');
		this.descriptor = await validateExtensionLaunchDescriptor(descriptor);
		this.stopping = false;
		this.fatalReport = undefined;
		this.deathCounted = false;
		this.exitRecorded = false;
		this.failedWrites = 0;
		this.setState({
			extensionId: this.extensionId,
			state: 'starting',
			consecutiveCrashes: this.state.consecutiveCrashes,
		});
		const childEntrypoint =
			this.options.childEntrypoint ??
			fileURLToPath(new URL('./child.js', import.meta.url));
		const child = fork(childEntrypoint, [], {
			cwd: this.descriptor.packageRoot,
			execPath: this.options.nodeExecutable,
			execArgv: [],
			env: extensionChildEnvironment(
				process.env,
				(this.descriptor.agentSessionSources ?? []).flatMap(
					(source) => source.environmentVariables ?? [],
				),
			),
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			serialization: 'json',
		});
		this.child = child;
		this.recordDiagnostic('spawned', {
			consecutiveFailures: this.state.consecutiveCrashes,
		});
		child.on('message', (message) => this.receive(message));
		// `on`, not `once`: a ChildProcess emits `error` for every failed write or
		// kill, and one with no listener is an uncaught exception in the process
		// that owns it. Here that is Terminay's main process, which aborts on one,
		// so a single extension dying mid-burst took the whole application down.
		child.on('error', (error) => this.childError(child, error));
		child.once('exit', (code, signal) => {
			if (this.child === child) this.childExited(code, signal);
		});
		try {
			const activated = await this.call(
				'activate',
				{
					extensionId: this.extensionId,
					apiVersion: EXTENSION_API_VERSION,
					entrypoint: this.descriptor.entrypoint,
					configDirectory: this.descriptor.configDirectory,
					dataDirectory: this.descriptor.dataDirectory,
					cacheDirectory: this.descriptor.cacheDirectory,
					permissions: [...this.descriptor.permissions],
					agentSessionSources:
						this.descriptor.agentSessionSources === undefined
							? []
							: structuredClone(this.descriptor.agentSessionSources),
					mcpInstallTargets:
						this.descriptor.mcpInstallTargets === undefined
							? []
							: structuredClone(this.descriptor.mcpInstallTargets),
					languageServers:
						this.descriptor.languageServers === undefined
							? []
							: structuredClone(this.descriptor.languageServers),
				},
				this.limits.startupTimeoutMs,
				undefined,
				true,
			);
			this.agentSessionSources = validateRegistrations(
				record(activated)?.agentSessionSources,
				this.descriptor.agentSessionSources ?? [],
				this.descriptor,
				'agent-observation',
				'agent session source',
			);
			this.mcpInstallTargets = validateRegistrations(
				record(activated)?.mcpInstallTargets,
				this.descriptor.mcpInstallTargets ?? [],
				this.descriptor,
				'mcp-registration',
				'MCP install target',
			);
			this.languageServers = validateLanguageServers(
				record(activated)?.languageServers,
				this.descriptor,
			);
			this.setState({
				extensionId: this.extensionId,
				state: 'running',
				consecutiveCrashes: 0,
			});
			this.recordDiagnostic('ready', { consecutiveFailures: 0 });
		} catch (error) {
			this.terminateChild();
			this.recordFailure(
				error instanceof Error
					? error
					: new Error('extension activation failed'),
			);
			throw error;
		}
	}

	async invoke(invocation: ExtensionInvocation): Promise<unknown> {
		if (this.state.state !== 'running' || this.child === undefined)
			throw new Error('extension is not running');
		if (this.pending.size >= this.limits.maxConcurrentInvocations)
			throw new Error('extension invocation admission limit reached');
		if (
			typeof invocation.method !== 'string' ||
			invocation.method.length === 0 ||
			invocation.method.length > 200
		)
			throw new TypeError('invalid extension method');
		return this.call(
			'invoke',
			{ method: invocation.method, input: invocation.input },
			invocation.deadlineMs ?? this.limits.invocationTimeoutMs,
			invocation.signal,
		);
	}

	/**
	 * Invoke one language operation on this extension's child.
	 *
	 * It is deliberately a distinct frame kind rather than an ordinary method
	 * invocation: core owns these operations, and an extension can neither
	 * declare nor shadow them.
	 */
	async invokeLanguage(
		invocation: ExtensionLanguageInvocation,
	): Promise<unknown> {
		if (this.state.state !== 'running' || this.child === undefined)
			throw unavailable('extension is not running');
		if (this.pending.size >= this.limits.maxConcurrentInvocations)
			throw unavailable('extension invocation admission limit reached');
		if (this.languageServers.length === 0)
			throw unavailable('extension contributes no language server');
		return this.call(
			'language.request',
			{ method: invocation.method, input: invocation.input },
			invocation.deadlineMs ?? this.limits.invocationTimeoutMs,
			invocation.signal,
		);
	}

	languageServerContributions(): readonly LanguageServerContribution[] {
		return this.languageServers;
	}

	async stop(): Promise<void> {
		this.stopping = true;
		const child = this.child;
		if (child === undefined) {
			// Stopping something that is already quarantined must not hide that:
			// the state is what tells a person why it is not running, and only an
			// explicit restart clears it.
			if (this.state.state !== 'quarantined')
				this.setState({
					extensionId: this.extensionId,
					state: 'stopped',
					consecutiveCrashes: this.state.consecutiveCrashes,
				});
			return;
		}
		await this.stopSessionSources();
		try {
			await this.call('deactivate', undefined, this.limits.shutdownTimeoutMs);
		} catch {
			/* bounded forced termination below */
		}
		this.terminateChild();
		this.rejectPending(new Error('extension host stopped'));
		this.setState({
			extensionId: this.extensionId,
			state: 'stopped',
			consecutiveCrashes: this.state.consecutiveCrashes,
		});
		this.recordDiagnostic('stopped', {
			deliberate: true,
			consecutiveFailures: this.state.consecutiveCrashes,
		});
		this.agentSessionSources = Object.freeze([]);
		this.mcpInstallTargets = Object.freeze([]);
		this.languageServers = Object.freeze([]);
	}

	/**
	 * Return a quarantined host to a startable state.
	 *
	 * Quarantine exists to stop a crash loop, so nothing clears it on its own.
	 * An explicit restart does, and it resets the crash window with it: the
	 * person asking is the evidence that the situation has changed.
	 */
	clearQuarantine(): void {
		if (this.child !== undefined)
			throw new Error('cannot clear quarantine while extension is running');
		const wasQuarantined = this.state.state === 'quarantined';
		this.crashTimes.length = 0;
		this.setState({
			extensionId: this.extensionId,
			state: 'stopped',
			consecutiveCrashes: 0,
		});
		if (wasQuarantined)
			this.recordDiagnostic('quarantine-cleared', { consecutiveFailures: 0 });
	}

	/** Registered session sources and MCP install targets. */
	sessionSourceContributions(): readonly AgentSessionSourceContribution[] {
		return this.agentSessionSources;
	}
	mcpInstallTargetContributions(): readonly McpInstallTargetContribution[] {
		return this.mcpInstallTargets;
	}

	/** Start one registered source with the harnesses switched on. */
	async startSessionSource(
		sourceId: string,
		enabledHarnesses: readonly string[],
	): Promise<void> {
		this.assertSource(sourceId);
		if (this.runningSources.has(sourceId)) {
			await this.setSessionSourceHarnesses(sourceId, enabledHarnesses);
			return;
		}
		this.runningSources.add(sourceId);
		try {
			await this.call(
				'agent.source.start',
				{ sourceId, enabledHarnesses: [...enabledHarnesses] },
				this.limits.invocationTimeoutMs,
			);
		} catch (error) {
			this.sourceStopped(sourceId);
			throw error;
		}
	}

	async stopSessionSource(sourceId: string): Promise<void> {
		if (!this.runningSources.has(sourceId)) return;
		await this.call(
			'agent.source.stop',
			{ sourceId },
			this.limits.shutdownTimeoutMs,
		).catch(() => undefined);
		this.sourceStopped(sourceId);
	}

	async setSessionSourceHarnesses(
		sourceId: string,
		enabledHarnesses: readonly string[],
	): Promise<void> {
		if (!this.runningSources.has(sourceId)) return;
		await this.call(
			'agent.source.harnesses',
			{ sourceId, enabledHarnesses: [...enabledHarnesses] },
			this.limits.invocationTimeoutMs,
		);
	}

	/** One call on a registered MCP install target. The result is validated
	 * before it leaves the host. */
	async invokeMcpTarget(
		targetId: string,
		operation: 'status' | 'install' | 'uninstall',
		server: McpServerCommand,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (!this.mcpInstallTargets.some((target) => target.id === targetId))
			throw unavailable('MCP install target is unavailable');
		if (!validateMcpServerCommand(server).ok)
			throw new TypeError('MCP server command is invalid');
		const result = await this.call(
			'mcp.target.invoke',
			{ targetId, operation, server: structuredClone(server) },
			this.limits.invocationTimeoutMs,
			signal,
		);
		const validated =
			operation === 'status'
				? validateMcpInstallTargetStatus(result)
				: validateMcpInstallTargetActionResult(result);
		if (!validated.ok)
			throw new Error('MCP install target returned an invalid result');
		return validated.value;
	}

	private assertSource(sourceId: string): void {
		if (!this.agentSessionSources.some((source) => source.id === sourceId))
			throw unavailable('agent session source is unavailable');
	}

	private async stopSessionSources(): Promise<void> {
		for (const sourceId of [...this.runningSources])
			await this.stopSessionSource(sourceId);
	}

	/** A source ends exactly once however it ends, and the bridge forgets its
	 * sessions then. */
	private sourceStopped(sourceId: string): void {
		if (!this.runningSources.delete(sourceId)) return;
		try {
			this.options.agents?.sourceStopped?.({
				extensionId: this.extensionId,
				sourceId,
			});
		} catch {
			/* the bridge's teardown cannot affect the host */
		}
	}

	private call(
		kind: HostFrame['kind'],
		payload: unknown,
		timeoutMs: number,
		signal?: AbortSignal,
		allowStarting = false,
	): Promise<unknown> {
		if (
			this.child === undefined ||
			(!allowStarting &&
				this.state.state !== 'running' &&
				kind !== 'deactivate')
		)
			return Promise.reject(new Error('extension child is unavailable'));
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000)
			return Promise.reject(new TypeError('invalid extension deadline'));
		const id = `${this.extensionId}:${++this.sequence}`;
		const frame: HostFrame = {
			protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
			kind,
			id,
			...(payload === undefined ? {} : { payload }),
		};
		if (frameByteLength(frame) > this.limits.maxMessageBytes)
			return Promise.reject(new Error('extension IPC message exceeds limit'));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.send({
					protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
					kind: 'cancel',
					id,
				});
				reject(new Error(`extension ${kind} timed out`));
			}, timeoutMs);
			const abort =
				signal === undefined
					? undefined
					: () => {
							clearTimeout(timer);
							this.pending.delete(id);
							this.send({
								protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
								kind: 'cancel',
								id,
							});
							reject(new Error('extension invocation cancelled'));
						};
			if (signal?.aborted) {
				clearTimeout(timer);
				reject(new Error('extension invocation cancelled'));
				return;
			}
			signal?.addEventListener('abort', abort!, { once: true });
			this.pending.set(id, {
				resolve,
				reject,
				timer,
				...(abort === undefined ? {} : { abort }),
			});
			if (this.send(frame) !== 'sent') {
				this.finishPending(
					id,
					undefined,
					new Error('extension IPC send failed'),
				);
			}
		});
	}

	/**
	 * Why a write did not happen, because the reasons are not alike.
	 *
	 * A frame over the message limit is the child and host disagreeing about
	 * the protocol. A closed channel is just what a child that has ended looks
	 * like from the writing side. Collapsing them into one boolean made every
	 * caller report whichever it happened to name, and a dying child was
	 * accused of misbehaving.
	 */
	private send(frame: HostFrame): 'sent' | 'channel-closed' | 'too-large' {
		if (frameByteLength(frame) > this.limits.maxMessageBytes)
			return 'too-large';
		if (this.child === undefined || !this.child.connected)
			return 'channel-closed';
		const child = this.child;
		try {
			// `false` only means the channel's write queue is long; the frame is
			// queued and will be delivered. A write the operating system refuses
			// later (EPIPE when the child has died) arrives at the callback, which
			// keeps it from being emitted as an `error` event instead.
			child.send(frame, (error) => {
				if (error !== null && error !== undefined)
					this.channelWriteFailed(child, error);
			});
			return 'sent';
		} catch {
			// `send` throws once the channel is closing, which is the same fact.
			return 'channel-closed';
		}
	}

	/**
	 * Write a frame the child is owed, and react only to a real violation.
	 *
	 * A frame too large for the channel is a protocol disagreement and is
	 * contained as one. A closed channel is recorded and dropped: the child has
	 * already ended, its exit is being handled by the path that owns it, and
	 * accusing it here would count that one death again for every operation
	 * that happened to be in flight.
	 */
	private sendOrViolate(frame: HostFrame, oversizeMessage: string): boolean {
		const result = this.send(frame);
		if (result === 'sent') return true;
		if (result === 'too-large') {
			this.protocolViolation(oversizeMessage);
			return false;
		}
		this.recordDiagnostic('channel-closed', {
			consecutiveFailures: this.state.consecutiveCrashes,
		});
		return false;
	}

	private receive(message: unknown): void {
		if (frameByteLength(message) > this.limits.maxMessageBytes) {
			this.protocolViolation('oversized child message');
			return;
		}
		if (!isChildFrame(message)) {
			this.protocolViolation('malformed child message');
			return;
		}
		if (message.kind === 'broker.cancel') {
			this.activeBrokerCalls.get(message.id)?.abort();
			return;
		}
		if (message.kind === 'broker.request') {
			void this.handleBrokerRequest(message);
			return;
		}
		if (message.kind === 'agent.source.publish') {
			void this.handleSessionPublication(message);
			return;
		}
		if (message.kind === 'agent.source.diagnostic') {
			this.handleSessionDiagnostic(message);
			return;
		}
		if (message.kind === 'language.diagnostics') {
			const notification = parseExtensionLanguageDiagnostics(message.payload);
			if (notification === undefined) {
				this.protocolViolation('language diagnostics notification is invalid');
				return;
			}
			try {
				this.options.onLanguageDiagnostics?.({
					...notification,
					extensionId: this.extensionId,
				});
			} catch {
				/* a diagnostics observer cannot affect the extension it observes */
			}
			return;
		}
		if (message.kind === 'language.session.exited') {
			const exit = parseExtensionLanguageSessionExit(message.payload);
			if (exit === undefined) {
				this.protocolViolation('language session exit is invalid');
				return;
			}
			try {
				this.options.onLanguageSessionExit?.({
					...exit,
					extensionId: this.extensionId,
				});
			} catch {
				/* an observer cannot affect the extension it observes */
			}
			if (exit.reason === 'exited') this.recordLanguageServerCrash(exit);
			return;
		}
		if (message.kind === 'agent.source.disposed') {
			const sourceId = boundedId(record(message.payload)?.sourceId);
			if (
				sourceId === undefined ||
				!this.agentSessionSources.some((source) => source.id === sourceId)
			) {
				this.protocolViolation('agent session source disposal is invalid');
				return;
			}
			this.agentSessionSources = Object.freeze(
				this.agentSessionSources.filter((source) => source.id !== sourceId),
			);
			this.sourceStopped(sourceId);
			return;
		}
		if (message.kind === 'mcp.target.disposed') {
			const targetId = boundedId(record(message.payload)?.targetId);
			if (targetId === undefined) {
				this.protocolViolation('MCP install target disposal is invalid');
				return;
			}
			this.mcpInstallTargets = Object.freeze(
				this.mcpInstallTargets.filter((target) => target.id !== targetId),
			);
			return;
		}
		if (message.kind === 'fatal') {
			// The child is already exiting. Hold its account until the exit that
			// follows records it; there is no pending call to settle.
			if (isExtensionFatalErrorReport(message.payload))
				this.fatalReport = message.payload;
			return;
		}
		if (
			message.kind === 'ready' ||
			message.kind === 'result' ||
			message.kind === 'deactivated'
		)
			this.finishPending(message.id, message.payload);
		else
			this.finishPending(
				message.id,
				undefined,
				new Error(failureMessage(message.payload)),
			);
	}

	private async handleBrokerRequest(frame: ChildFrame): Promise<void> {
		if (this.activeBrokerCalls.size >= this.limits.maxConcurrentInvocations) {
			this.sendBrokerResult(
				frame.id,
				undefined,
				'broker admission limit reached',
			);
			return;
		}
		const payload = record(frame.payload);
		const operation = payload?.operation;
		if (operation !== 'log' && operation !== 'secret.resolve') {
			this.sendBrokerResult(
				frame.id,
				undefined,
				'unsupported broker operation',
			);
			return;
		}
		const controller = new AbortController();
		this.activeBrokerCalls.set(frame.id, controller);
		try {
			const result =
				operation === 'secret.resolve'
					? await this.resolveSecret(payload?.payload, controller.signal)
					: await this.options.broker.request(
							{
								extensionId: this.extensionId,
								operation,
								payload: payload?.payload,
							},
							controller.signal,
						);
			this.sendBrokerResult(frame.id, result);
		} catch (error) {
			this.sendBrokerResult(
				frame.id,
				undefined,
				error instanceof Error ? error.message : 'broker request failed',
			);
		} finally {
			this.activeBrokerCalls.delete(frame.id);
		}
	}

	/**
	 * One batch of publisher calls from a running source. The frame is checked
	 * here; every snapshot is validated by the bridge before anything applies.
	 * A source that publishes faster than the bridge drains is told to resend
	 * its live set rather than being queued without bound.
	 */
	private async handleSessionPublication(frame: ChildFrame): Promise<void> {
		const payload = record(frame.payload);
		const sourceId = boundedId(payload?.sourceId);
		const reset = payload?.reset;
		const upserts = payload?.upserts;
		const removals = payload?.removals;
		const shapeValid =
			sourceId !== undefined &&
			(reset === undefined || Array.isArray(reset)) &&
			(upserts === undefined || Array.isArray(upserts)) &&
			(removals === undefined || Array.isArray(removals));
		if (
			!shapeValid ||
			!this.runningSources.has(sourceId) ||
			this.options.agents === undefined
		) {
			this.sendSessionAck(frame.id, {
				ok: false,
				failure: 'agent session source is not running',
			});
			return;
		}
		if (
			this.agentPublicationsInFlight >= this.limits.maxConcurrentInvocations
		) {
			this.sendSessionAck(frame.id, {
				ok: false,
				resend: true,
				failure: 'agent session publication is backpressured',
			});
			return;
		}
		this.agentPublicationsInFlight += 1;
		const controller = new AbortController();
		this.activeBrokerCalls.set(frame.id, controller);
		try {
			const result = await this.options.agents.publish(
				{
					extensionId: this.extensionId,
					sourceId,
					publication: {
						...(reset === undefined ? {} : { reset: reset as unknown[] }),
						...(upserts === undefined
							? {}
							: { upserts: upserts as unknown[] }),
						...(removals === undefined
							? {}
							: { removals: removals as unknown[] }),
					},
				},
				controller.signal,
			);
			this.sendSessionAck(frame.id, {
				ok: result.ok,
				...(result.resend === true ? { resend: true } : {}),
				...(result.failure === undefined
					? {}
					: { failure: safeFailure(new Error(result.failure)) }),
			});
		} catch (error) {
			this.sendSessionAck(frame.id, {
				ok: false,
				failure: safeFailure(
					error instanceof Error
						? error
						: new Error('agent session publication failed'),
				),
			});
		} finally {
			this.activeBrokerCalls.delete(frame.id);
			this.agentPublicationsInFlight -= 1;
		}
	}

	private handleSessionDiagnostic(frame: ChildFrame): void {
		const payload = record(frame.payload);
		const sourceId = boundedId(payload?.sourceId);
		if (sourceId === undefined || !this.runningSources.has(sourceId)) return;
		try {
			this.options.agents?.diagnostic?.({
				extensionId: this.extensionId,
				sourceId,
				diagnostic: payload?.diagnostic,
			});
		} catch {
			/* a diagnostic sink cannot affect the extension */
		}
	}

	private sendSessionAck(
		id: string,
		acknowledgement: {
			readonly ok: boolean;
			readonly resend?: boolean;
			readonly failure?: string;
		},
	): void {
		this.sendOrViolate(
			{
				protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
				kind: 'agent.source.ack',
				id,
				payload: acknowledgement,
			},
			'agent session acknowledgement exceeds IPC limit',
		);
	}

	private async resolveSecret(
		input: unknown,
		signal: AbortSignal,
	): Promise<unknown> {
		if (this.options.secrets === undefined || this.descriptor === undefined)
			throw new Error('extension secret broker is unavailable');
		if (signal.aborted) throw new Error('extension secret access cancelled');
		const request = record(input);
		const profileId = boundedId(request?.profileId);
		const fieldId = boundedId(request?.fieldId);
		if (profileId === undefined || fieldId === undefined)
			throw new Error('extension secret access is denied');
		return this.options.secrets.withSecret(
			{
				extensionId: this.extensionId,
				permissions: new Set(
					this.descriptor.permissions.map((permission) =>
						permission === 'secrets:resolve'
							? 'extension-secrets:resolve'
							: permission,
					),
				),
			},
			{ profileId, fieldId },
			(secret) => {
				if (signal.aborted)
					throw new Error('extension secret access cancelled');
				// The numeric array is the one bounded structured-clone copy crossing
				// private IPC. The vault/broker-owned Uint8Array is cleared by its
				// callback lifetime before this method returns.
				return [...secret];
			},
		);
	}

	private sendBrokerResult(
		id: string,
		value?: unknown,
		failure?: string,
	): void {
		const payload =
			failure === undefined ? { ok: true, value } : { ok: false, failure };
		this.sendOrViolate(
			{
				protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION,
				kind: 'broker.result',
				id,
				payload,
			},
			'broker response exceeds IPC limit',
		);
	}

	private finishPending(id: string, result?: unknown, error?: Error): void {
		const pending = this.pending.get(id);
		if (pending === undefined) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		if (pending.abort !== undefined) {
			/* listener is once and harmless after settlement */
		}
		error === undefined ? pending.resolve(result) : pending.reject(error);
	}

	/**
	 * Count one language server death against this extension.
	 *
	 * A language server is a child of the extension child, so its death does not
	 * end the extension. It is still this extension's failure: the crash window
	 * is the same one that decides quarantine, and the child reports each death
	 * exactly once, so nothing here can count one death twice.
	 */
	private recordLanguageServerCrash(exit: ExtensionLanguageSessionExit): void {
		const error = new Error(
			`language server ${exit.languageServerId} exited (${exit.exitCode ?? exit.signal ?? 'unknown'})`,
		);
		const now = this.now();
		this.crashTimes.push(now);
		while ((this.crashTimes[0] ?? now) < now - this.limits.crashWindowMs)
			this.crashTimes.shift();
		const crashes = this.crashTimes.length;
		this.recordDiagnostic('failed', {
			consecutiveFailures: crashes,
			error: extensionErrorDetail(error),
		});
		if (crashes < this.limits.maxCrashesInWindow) return;
		// Repeated language server deaths are a crash loop like any other, and
		// quarantine is what stops one. Ending the child ends its sessions, and
		// nothing it still owed can arrive afterwards, so settle it all here.
		this.terminateChild();
		this.rejectPending(error);
		this.setState({
			extensionId: this.extensionId,
			state: 'quarantined',
			consecutiveCrashes: crashes,
			failure: safeFailure(error),
		});
		this.recordDiagnostic('quarantined', {
			consecutiveFailures: crashes,
			error: extensionErrorDetail(error),
		});
	}

	private protocolViolation(message: string): void {
		this.terminateChild();
		this.recordFailure(new Error(message));
	}
	/**
	 * An `error` event from a child. The first one for the current incarnation
	 * is a failure of that child; any after it, or from a child already
	 * replaced, is recorded so the reader can see it and is otherwise inert.
	 */
	private childError(child: ChildProcess, error: Error): void {
		if (this.child === child && !this.deathCounted) {
			this.recordDiagnostic('child-error', {
				error: extensionErrorDetail(error),
				...errorCodeDetail(error),
			});
			if (!this.stopping) this.recordFailure(error);
			return;
		}
		this.recordDiagnostic('child-error', {
			error: extensionErrorDetail(error),
			...errorCodeDetail(error),
			afterChildGone: true,
		});
	}

	/**
	 * A frame the channel accepted and the operating system then refused. It
	 * means the child has gone; its exit is handled by the path that owns it.
	 * The first refusal is recorded with its cause, and the rest are counted
	 * onto the exit record rather than flooding the history.
	 */
	private channelWriteFailed(child: ChildProcess, error: Error): void {
		if (this.child !== child) return;
		this.failedWrites += 1;
		if (this.failedWrites > 1) return;
		this.recordDiagnostic('channel-write-failed', {
			consecutiveFailures: this.state.consecutiveCrashes,
			error: extensionErrorDetail(error),
			...errorCodeDetail(error),
		});
	}
	private childExited(code: number | null, signal: string | null): void {
		this.child = undefined;
		// Recorded whatever the reason, and before the failure branch below, so a
		// child that died without reporting still leaves its exit status behind.
		this.exitRecorded = true;
		this.recordDiagnostic('child-exited', {
			exitCode: code,
			signal,
			deliberate: this.stopping,
			...(this.failedWrites === 0 ? {} : { failedWrites: this.failedWrites }),
			pendingCalls: this.pending.size,
			activeAgentPublications: this.agentPublicationsInFlight,
			...(this.fatalReport === undefined
				? {}
				: {
						error: {
							name: this.fatalReport.name,
							message: this.fatalReport.message,
							...(this.fatalReport.stack === undefined
								? {}
								: { stack: this.fatalReport.stack }),
						},
					}),
		});
		this.rejectPending(new Error('extension child exited'));
		for (const controller of this.activeBrokerCalls.values())
			controller.abort();
		this.activeBrokerCalls.clear();
		for (const sourceId of [...this.runningSources])
			this.sourceStopped(sourceId);
		if (
			!this.stopping &&
			this.state.state !== 'failed' &&
			this.state.state !== 'quarantined'
		)
			this.recordFailure(
				new Error(`extension child exited (${code ?? signal ?? 'unknown'})`),
			);
	}

	/**
	 * Count one death, however many operations discover it.
	 *
	 * A child ending fails everything that was in flight at the time, and the
	 * bridge admits dozens of publications per context. Counting each discovery
	 * turned one death into ten crashes in two milliseconds, which cleared a
	 * threshold meant to describe repeated deaths over a minute. The failure is
	 * recorded either way; only the crash window is left alone once the child
	 * for this incarnation has already gone.
	 */
	private recordFailure(error: Error): void {
		if (this.child === undefined && this.deathCounted) {
			this.recordDiagnostic('failed', {
				consecutiveFailures: this.state.consecutiveCrashes,
				error: extensionErrorDetail(error),
				afterChildGone: true,
			});
			this.rejectPending(error);
			return;
		}
		this.deathCounted = true;
		const now = this.now();
		this.crashTimes.push(now);
		while ((this.crashTimes[0] ?? now) < now - this.limits.crashWindowMs)
			this.crashTimes.shift();
		const crashes = this.crashTimes.length;
		this.rejectPending(error);
		for (const sourceId of [...this.runningSources])
			this.sourceStopped(sourceId);
		this.agentSessionSources = Object.freeze([]);
		this.mcpInstallTargets = Object.freeze([]);
		// The child's own report is the only account of what actually threw; the
		// host-side error is usually just the exit that followed it.
		const detail = this.reportedFatalDetail() ?? extensionErrorDetail(error);
		this.recordDiagnostic('failed', {
			consecutiveFailures: crashes,
			error: detail,
		});
		if (crashes >= this.limits.maxCrashesInWindow) {
			this.setState({
				extensionId: this.extensionId,
				state: 'quarantined',
				consecutiveCrashes: crashes,
				failure: safeFailure(error),
			});
			this.recordDiagnostic('quarantined', {
				consecutiveFailures: crashes,
				error: detail,
			});
			return;
		}
		const backoff = Math.min(
			this.limits.initialBackoffMs * 2 ** Math.max(0, crashes - 1),
			this.limits.maxBackoffMs,
		);
		const restartAt = now + backoff;
		this.setState({
			extensionId: this.extensionId,
			state: 'failed',
			consecutiveCrashes: crashes,
			restartAt,
			failure: safeFailure(error),
		});
		this.recordDiagnostic('restart-scheduled', {
			consecutiveFailures: crashes,
			restartAt,
		});
	}

	/** Publish state once, so no transition can reach a supervisor unobserved. */
	private setState(next: ExtensionHostStatus): void {
		this.state = next;
		try {
			this.options.onStateChange?.(this.status());
		} catch {
			/* an observer must never change a lifecycle transition */
		}
	}

	private recordDiagnostic(
		transition: ExtensionHostTransition,
		detail: Omit<ExtensionHostDiagnostic, 'extensionId' | 'transition' | 'at'>,
	): void {
		const listener = this.options.onDiagnostic;
		if (listener === undefined) return;
		try {
			listener({
				extensionId: this.extensionId,
				transition,
				at: this.now(),
				...detail,
			});
		} catch {
			/* a diagnostic sink must never break the host it observes */
		}
	}

	/** The child's fatal report, consumed once by the failure it explains. */
	private reportedFatalDetail(): ExtensionErrorDetail | undefined {
		const report = this.fatalReport;
		if (report === undefined) return undefined;
		this.fatalReport = undefined;
		return {
			name: report.name,
			message: report.message,
			...(report.stack === undefined ? {} : { stack: report.stack }),
		};
	}

	/**
	 * Kill a child the host has given up on, without claiming to know how it
	 * died.
	 *
	 * Detaching the listeners drops the `exit` event that carries the real code
	 * or signal, so a child that had already ended used to be recorded as this
	 * SIGKILL instead — the host's own kill overwriting the evidence of the
	 * death it was reacting to. An exit already observed for this child is left
	 * to stand, and this records only what it is: the host terminating it.
	 */
	private terminateChild(): void {
		const child = this.child;
		this.child = undefined;
		if (child === undefined) return;
		if (!this.exitRecorded)
			this.recordDiagnostic('child-terminated', {
				deliberate: this.stopping,
				...(this.fatalReport === undefined
					? {}
					: { error: this.reportedFatalDetail() }),
			});
		child.removeAllListeners();
		// A write queued before this point can still fail, and `kill` itself can.
		// Either arrives as an `error` event, which must never go unheard.
		child.on('error', (error) => this.childError(child, error));
		child.kill('SIGKILL');
	}
	private rejectPending(error: Error): void {
		for (const id of [...this.pending.keys()])
			this.finishPending(id, undefined, error);
	}
}

function errorCodeDetail(error: Error): { errorCode?: string } {
	const code = (error as NodeJS.ErrnoException).code;
	return typeof code === 'string' ? { errorCode: code } : {};
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function failureMessage(value: unknown): string {
	const message = record(value)?.message;
	return typeof message === 'string'
		? message.slice(0, 1_000)
		: 'extension operation failed';
}
function safeFailure(error: Error): string {
	return error.message.replace(/[\r\n]/gu, ' ').slice(0, 1_000);
}
function boundedId(value: unknown): string | undefined {
	return typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value)
		? value
		: undefined;
}
/**
 * Every source or target the child registered must be one the manifest
 * contributed, under this extension's namespace and permission. An undeclared
 * registration is an activation failure, not a silently ignored one.
 */
function validateRegistrations<T extends { readonly id: string }>(
	value: unknown,
	declaredContributions: readonly T[],
	descriptor: ExtensionLaunchDescriptor,
	permission: string,
	label: string,
): readonly T[] {
	if (value === undefined) return Object.freeze([]);
	if (
		!Array.isArray(value) ||
		value.length > EXTENSION_LIMITS.contributions ||
		(value.length > 0 && !descriptor.permissions.includes(permission))
	)
		throw new Error(`extension returned invalid ${label} registrations`);
	const declared = new Map(
		declaredContributions.map((contribution) => [
			contribution.id,
			contribution,
		]),
	);
	const seen = new Set<string>();
	const result: T[] = [];
	for (const id of value) {
		if (
			typeof id !== 'string' ||
			seen.has(id) ||
			!isNamespacedId(id, descriptor.extensionId)
		)
			throw new Error(`extension returned invalid ${label} registrations`);
		const contribution = declared.get(id);
		if (contribution === undefined)
			throw new Error(`extension registered an undeclared ${label}`);
		seen.add(id);
		result.push(structuredClone(contribution));
	}
	return Object.freeze(result);
}

/** Every language server the child registered must be one the manifest
 * contributed, exactly as agent providers are. An undeclared registration is
 * an activation failure, not a silently ignored contribution. */
function validateLanguageServers(
	value: unknown,
	descriptor: ExtensionLaunchDescriptor,
): readonly LanguageServerContribution[] {
	if (value === undefined) return Object.freeze([]);
	if (!Array.isArray(value) || value.length > 32)
		throw new Error('extension returned invalid language server registrations');
	const declared = new Map(
		(descriptor.languageServers ?? []).map((contribution) => [
			contribution.id,
			contribution,
		]),
	);
	const seen = new Set<string>();
	const result: LanguageServerContribution[] = [];
	for (const id of value) {
		if (typeof id !== 'string' || seen.has(id))
			throw new Error(
				'extension returned invalid language server registrations',
			);
		const contribution = declared.get(id);
		if (contribution === undefined)
			throw new Error('extension registered an undeclared language server');
		seen.add(id);
		result.push(structuredClone(contribution));
	}
	return Object.freeze(result);
}

function unavailable(message: string): Error {
	return Object.assign(new Error(message), {
		code: 'unavailable',
		retryable: true,
	});
}
